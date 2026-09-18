/*
 * IndexedDB 数据层：在浏览器 / PWA 环境下替代 Rust + SQLite 后端。
 * 命令名与参数和 Tauri 命令保持一致，便于 main.js 无缝切换。
 * 动作直接属于计划（plan_items 内保存动作信息），没有全局动作库。
 */
(function () {
  const DB_NAME = "fitness-planner";
  const DB_VERSION = 2;
  const PLANS = "plans";
  const ITEMS = "plan_items";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前环境不支持 IndexedDB"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction;
        const oldExercises = db.objectStoreNames.contains("exercises");
        const oldItems = db.objectStoreNames.contains(ITEMS);
        const exMap = {};

        const finish = () => {
          if (oldItems) {
            tx.objectStore(ITEMS).openCursor().onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur) return;
              const rec = cur.value;
              if (rec.name == null) {
                const ex = exMap[rec.exercise_id] || {};
                rec.name = ex.name || "(未命名动作)";
                rec.muscle_group = ex.muscle_group || "";
                rec.video_url = ex.video_url ?? null;
                delete rec.exercise_id;
                cur.update(rec);
              }
              cur.continue();
            };
          }
          if (oldExercises) db.deleteObjectStore("exercises");
          if (!db.objectStoreNames.contains(PLANS)) {
            db.createObjectStore(PLANS, { keyPath: "id", autoIncrement: true });
          }
          if (!db.objectStoreNames.contains(ITEMS)) {
            const s = db.createObjectStore(ITEMS, { keyPath: "id", autoIncrement: true });
            s.createIndex("plan_id", "plan_id", { unique: false });
          }
        };

        if (oldExercises) {
          tx.objectStore("exercises").openCursor().onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) {
              exMap[cur.value.id] = cur.value;
              cur.continue();
              return;
            }
            finish();
          };
        } else {
          finish();
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function now() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  function getAll(storeName) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function getOne(storeName, key) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function getAllByIndex(storeName, indexName, value) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = db
            .transaction(storeName, "readonly")
            .objectStore(storeName)
            .index(indexName)
            .getAll(value);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  const cstr = (a, b) => {
    const x = String(a || "");
    const y = String(b || "");
    return x < y ? -1 : x > y ? 1 : 0;
  };

  /* ---------------- 训练计划 ---------------- */
  async function listPlans() {
    const [plans, items] = await Promise.all([getAll(PLANS), getAll(ITEMS)]);
    const counts = {};
    items.forEach((i) => {
      counts[i.plan_id] = (counts[i.plan_id] || 0) + 1;
    });
    return plans
      .map((p) => ({
        id: p.id,
        name: p.name,
        goal: p.goal || "",
        created_at: p.created_at,
        item_count: counts[p.id] || 0,
      }))
      .sort((a, b) => -cstr(a.created_at, b.created_at) || b.id - a.id);
  }

  async function getPlan({ id }) {
    const plan = await getOne(PLANS, id);
    if (!plan) throw new Error("计划不存在");
    const items = await getAllByIndex(ITEMS, "plan_id", id);
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal || "",
      notes: plan.notes ?? null,
      created_at: plan.created_at,
      items: items
        .map((i) => ({
          id: i.id,
          name: i.name || "(未命名动作)",
          muscle_group: i.muscle_group || "",
          video_url: i.video_url ?? null,
          day_label: i.day_label,
          sets: i.sets,
          reps: i.reps,
          weight_kg: i.weight_kg,
          rest_sec: i.rest_sec,
          sort_order: i.sort_order,
        }))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    };
  }

  function normalizeItem(planId, it, index) {
    return {
      plan_id: planId,
      name: it.name || "",
      muscle_group: it.muscle_group || "",
      video_url: it.video_url ?? null,
      day_label: it.day_label || "第 1 天",
      sets: Number(it.sets) || 0,
      reps: Number(it.reps) || 0,
      weight_kg: Number(it.weight_kg) || 0,
      rest_sec: Number(it.rest_sec) || 0,
      sort_order: it.sort_order ?? index,
    };
  }

  function createPlan({ input }) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction([PLANS, ITEMS], "readwrite");
          const itemsStore = t.objectStore(ITEMS);
          let planId = null;
          const add = t.objectStore(PLANS).add({
            name: input.name,
            goal: input.goal ?? "",
            notes: input.notes ?? null,
            created_at: now(),
          });
          add.onsuccess = () => {
            planId = add.result;
            (input.items || []).forEach((it, i) => itemsStore.add(normalizeItem(planId, it, i)));
          };
          add.onerror = () => reject(add.error);
          t.oncomplete = () => resolve(planId);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function updatePlan({ id, input }) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction([PLANS, ITEMS], "readwrite");
          const itemsStore = t.objectStore(ITEMS);
          const plansStore = t.objectStore(PLANS);
          plansStore.get(id).onsuccess = (e) => {
            const prev = e.target.result || {};
            plansStore.put({
              id,
              name: input.name,
              goal: input.goal ?? "",
              notes: input.notes ?? null,
              created_at: prev.created_at || now(),
            });
          };
          const keysReq = itemsStore.index("plan_id").getAllKeys(id);
          keysReq.onsuccess = () => {
            keysReq.result.forEach((k) => itemsStore.delete(k));
            (input.items || []).forEach((it, i) => itemsStore.add(normalizeItem(id, it, i)));
          };
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function deletePlan({ id }) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction([PLANS, ITEMS], "readwrite");
          t.objectStore(PLANS).delete(id);
          const itemsStore = t.objectStore(ITEMS);
          const keysReq = itemsStore.index("plan_id").getAllKeys(id);
          keysReq.onsuccess = () => keysReq.result.forEach((k) => itemsStore.delete(k));
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        })
    );
  }

  const handlers = {
    list_plans: () => listPlans(),
    get_plan: (a) => getPlan(a),
    create_plan: (a) => createPlan(a),
    update_plan: (a) => updatePlan(a),
    delete_plan: (a) => deletePlan(a),
  };

  function call(cmd, args) {
    const fn = handlers[cmd];
    if (!fn) return Promise.reject(new Error("未知命令: " + cmd));
    return fn(args || {});
  }

  window.FitnessDB = { openDB, call };
})();
