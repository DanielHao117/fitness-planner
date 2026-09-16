/*
 * IndexedDB 数据层：在浏览器 / PWA 环境下替代 Rust + SQLite 后端。
 * 命令名与参数和 Tauri 命令保持一致，便于 main.js 无缝切换。
 */
(function () {
  const DB_NAME = "fitness-planner";
  const DB_VERSION = 1;
  const STORES = { exercises: "exercises", plans: "plans", plan_items: "plan_items" };

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
        if (!db.objectStoreNames.contains(STORES.exercises)) {
          const s = db.createObjectStore(STORES.exercises, { keyPath: "id", autoIncrement: true });
          s.createIndex("muscle_group", "muscle_group", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.plans)) {
          db.createObjectStore(STORES.plans, { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORES.plan_items)) {
          const s = db.createObjectStore(STORES.plan_items, { keyPath: "id", autoIncrement: true });
          s.createIndex("plan_id", "plan_id", { unique: false });
          s.createIndex("exercise_id", "exercise_id", { unique: false });
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

  /* ---------------- 动作库 ---------------- */
  async function listExercises() {
    const rows = await getAll(STORES.exercises);
    return rows
      .sort((a, b) => cstr(a.muscle_group, b.muscle_group) || cstr(a.name, b.name))
      .map((r) => ({
        id: r.id,
        name: r.name,
        muscle_group: r.muscle_group || "",
        video_url: r.video_url ?? null,
        notes: r.notes ?? null,
      }));
  }

  function createExercise({ input }) {
    const rec = {
      name: input.name,
      muscle_group: input.muscle_group ?? "",
      video_url: input.video_url ?? null,
      notes: input.notes ?? null,
      created_at: now(),
    };
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const req = db.transaction(STORES.exercises, "readwrite").objectStore(STORES.exercises).add(rec);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function deleteExercise({ id }) {
    return openDB().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction([STORES.exercises, STORES.plan_items], "readwrite");
          t.objectStore(STORES.exercises).delete(id);
          const itemsStore = t.objectStore(STORES.plan_items);
          const idx = itemsStore.index("exercise_id");
          const q = idx.getAllKeys(id);
          q.onsuccess = () => q.result.forEach((k) => itemsStore.delete(k));
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        })
    );
  }

  /* ---------------- 训练计划 ---------------- */
  async function listPlans() {
    const [plans, items] = await Promise.all([getAll(STORES.plans), getAll(STORES.plan_items)]);
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
    const plan = await getOne(STORES.plans, id);
    if (!plan) throw new Error("计划不存在");
    const [items, exercises] = await Promise.all([
      getAllByIndex(STORES.plan_items, "plan_id", id),
      getAll(STORES.exercises),
    ]);
    const exMap = {};
    exercises.forEach((e) => {
      exMap[e.id] = e;
    });
    const mapped = items
      .map((i) => {
        const ex = exMap[i.exercise_id] || {};
        return {
          id: i.id,
          exercise_id: i.exercise_id,
          exercise_name: ex.name || "(已删除动作)",
          muscle_group: ex.muscle_group || "",
          video_url: ex.video_url ?? null,
          day_label: i.day_label,
          sets: i.sets,
          reps: i.reps,
          weight_kg: i.weight_kg,
          rest_sec: i.rest_sec,
          sort_order: i.sort_order,
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    return {
      id: plan.id,
      name: plan.name,
      goal: plan.goal || "",
      notes: plan.notes ?? null,
      created_at: plan.created_at,
      items: mapped,
    };
  }

  function normalizeItem(planId, it, index) {
    return {
      plan_id: planId,
      exercise_id: Number(it.exercise_id),
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
          const t = db.transaction([STORES.plans, STORES.plan_items], "readwrite");
          const itemsStore = t.objectStore(STORES.plan_items);
          let planId = null;
          const add = t.objectStore(STORES.plans).add({
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
          const t = db.transaction([STORES.plans, STORES.plan_items], "readwrite");
          const itemsStore = t.objectStore(STORES.plan_items);
          const plansStore = t.objectStore(STORES.plans);
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
          const t = db.transaction([STORES.plans, STORES.plan_items], "readwrite");
          t.objectStore(STORES.plans).delete(id);
          const itemsStore = t.objectStore(STORES.plan_items);
          const keysReq = itemsStore.index("plan_id").getAllKeys(id);
          keysReq.onsuccess = () => keysReq.result.forEach((k) => itemsStore.delete(k));
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
        })
    );
  }

  const handlers = {
    list_exercises: () => listExercises(),
    create_exercise: (a) => createExercise(a),
    delete_exercise: (a) => deleteExercise(a),
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
