const tauriCore = window.__TAURI__ && window.__TAURI__.core;
const IS_TAURI = !!(tauriCore && typeof tauriCore.invoke === "function");
const invoke = IS_TAURI ? tauriCore.invoke : (cmd, args) => window.FitnessDB.call(cmd, args);
const convertFileSrc =
  IS_TAURI && tauriCore.convertFileSrc ? tauriCore.convertFileSrc : (p) => p;

const MUSCLE_GROUPS = ["胸", "肩", "背", "腿"];

const EXERCISE_PRESETS = {
  胸: [
    "平板杠铃卧推",
    "上斜杠铃卧推",
    "平板哑铃卧推",
    "上斜哑铃卧推",
    "哑铃飞鸟",
    "蝴蝶机夹胸",
    "双杠臂屈伸",
    "俯卧撑",
  ],
  肩: [
    "站姿杠铃推举",
    "坐姿哑铃推举",
    "阿诺德推举",
    "哑铃侧平举",
    "哑铃前平举",
    "俯身哑铃飞鸟",
    "面拉",
    "杠铃耸肩",
  ],
  背: [
    "引体向上",
    "高位下拉",
    "杠铃划船",
    "坐姿划船",
    "单臂哑铃划船",
    "硬拉",
    "直臂下压",
    "T杠划船",
  ],
  腿: [
    "杠铃深蹲",
    "前蹲",
    "腿举",
    "罗马尼亚硬拉",
    "保加利亚分腿蹲",
    "箭步蹲",
    "坐姿腿屈伸",
    "俯卧腿弯举",
    "站姿提踵",
  ],
};

const state = {
  plans: [],
  editing: { id: null, items: [] },
  library: { groups: [] },
  libSelected: 0,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

async function call(cmd, args) {
  try {
    return await invoke(cmd, args);
  } catch (e) {
    alert(`操作失败：${e}`);
    throw e;
  }
}

/* ---------------- 动作库（可增删改，持久化到数据库） ---------------- */
const LIBRARY_KEY = "exercise_library";

function defaultLibrary() {
  return {
    groups: MUSCLE_GROUPS.map((name) => ({
      name,
      exercises: [...EXERCISE_PRESETS[name]],
    })),
  };
}

async function loadLibrary() {
  const raw = await call("get_setting", { key: LIBRARY_KEY });
  if (raw) {
    try {
      const lib = JSON.parse(raw);
      if (lib && Array.isArray(lib.groups)) {
        state.library = lib;
        return;
      }
    } catch {
      /* ignore, fall back */
    }
  }
  state.library = defaultLibrary();
}

function saveLibrary() {
  return call("set_setting", {
    key: LIBRARY_KEY,
    value: JSON.stringify(state.library),
  });
}

function groupNames() {
  return state.library.groups.map((g) => g.name);
}

function exercisesFor(group) {
  const g = state.library.groups.find((x) => x.name === group);
  return g ? g.exercises : [];
}

/* ---------------- 弹层 ---------------- */
function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
}
function closeModal(id) {
  if (id === "video-modal") $("#video-body").innerHTML = "";
  if (id === "wheel-modal") wheelState = null;
  $(`#${id}`).classList.add("hidden");
  if (id === "library-modal" && !$("#plan-modal").classList.contains("hidden")) {
    renderPlanItems();
  }
}
$$("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => closeModal(btn.dataset.close))
);
$$(".overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeModal(ov.id);
  })
);

/* ---------------- 视频播放 ---------------- */
function youtubeId(url) {
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/
  );
  return m ? m[1] : null;
}

function playVideo(title, url) {
  $("#video-title").textContent = title || "动作演示";
  const body = $("#video-body");
  const yt = url && youtubeId(url);
  if (yt) {
    body.innerHTML = `<iframe src="https://www.youtube.com/embed/${yt}" allowfullscreen></iframe>`;
  } else if (!url) {
    body.innerHTML = `<p class="empty">该动作没有配置视频。</p>`;
  } else if (!IS_TAURI && !/^https?:\/\//i.test(url)) {
    body.innerHTML = `<p class="empty">浏览器版无法播放本地文件路径，请改用网络视频链接。</p>`;
  } else {
    const src = /^https?:\/\//i.test(url) ? url : convertFileSrc(url);
    body.innerHTML = `<video controls autoplay src="${esc(src)}"></video>`;
  }
  openModal("video-modal");
}

/* ---------------- 训练计划 ---------------- */
async function loadPlans() {
  state.plans = await call("list_plans");
  renderPlans();
}

function renderPlans() {
  const list = $("#plans-list");
  const empty = $("#plans-empty");
  list.innerHTML = state.plans
    .map(
      (p) => `
      <div class="card">
        <h3 class="plan-title" data-open="${p.id}">${esc(p.name)}</h3>
        <div class="meta">${p.item_count} 个动作 · ${esc(
        (p.created_at || "").slice(0, 10)
      )}</div>
        <div class="row">
          <button class="ghost" data-open="${p.id}">查看</button>
          <button class="ghost" data-edit="${p.id}">编辑</button>
          <button class="ghost" data-del-plan="${p.id}">删除</button>
        </div>
      </div>`
    )
    .join("");
  empty.classList.toggle("hidden", state.plans.length > 0);
}

function autoPlanName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 训练`;
}

$("#new-plan").addEventListener("click", () => {
  state.editing = { id: null, name: autoPlanName(), items: [] };
  $("#plan-modal-title").textContent = "新建计划";
  renderPlanItems();
  openModal("plan-modal");
});

function nameOptions(group, current) {
  const presets = exercisesFor(group);
  const has = presets.includes(current);
  return (
    `<option value="">选择动作</option>` +
    (!has && current
      ? `<option value="${esc(current)}" selected>${esc(current)}</option>`
      : "") +
    presets
      .map(
        (n) =>
          `<option value="${esc(n)}" ${n === current ? "selected" : ""}>${esc(
            n
          )}</option>`
      )
      .join("") +
    `<option value="__custom__">自定义名称…</option>`
  );
}

function renderPlanItems() {
  const wrap = $("#plan-items");
  wrap.innerHTML =
    `<div class="item-head"><span>部位</span><span>动作</span><span>组</span><span>次</span><span>重量kg</span><span></span></div>` +
    state.editing.items
      .map((it, i) => {
        const presets = exercisesFor(it.muscle_group);
        const isCustom = it.custom || (!!it.name && !presets.includes(it.name));
        const nameField = isCustom
          ? `<input data-field="name" placeholder="自定义动作名称" value="${esc(
              it.name
            )}" />`
          : `<select data-field="name">${nameOptions(
              it.muscle_group,
              it.name
            )}</select>`;
        const groups = groupNames();
        const groupList =
          !it.muscle_group || groups.includes(it.muscle_group)
            ? groups
            : [it.muscle_group, ...groups];
        return `
    <div class="item-row" data-index="${i}">
      <select data-field="muscle_group">
        ${groupList
          .map(
            (g) =>
              `<option value="${esc(g)}" ${
                g === it.muscle_group ? "selected" : ""
              }>${esc(g)}</option>`
          )
          .join("")}
      </select>
      ${nameField}
      <button type="button" class="val" data-wheel-open="${i}" data-field="sets">${
        it.sets
      }</button>
      <button type="button" class="val" data-wheel-open="${i}" data-field="reps">${
        it.reps
      }</button>
      <button type="button" class="val" data-wheel-open="${i}" data-field="weight_kg">${
        it.weight_kg
      }</button>
      <button class="remove" data-remove="${i}" title="移除">✕</button>
    </div>`;
      })
      .join("");
  $("#items-empty").classList.toggle("hidden", state.editing.items.length > 0);
}

$("#plan-items").addEventListener("input", (e) => {
  const row = e.target.closest(".item-row");
  if (!row) return;
  const it = state.editing.items[Number(row.dataset.index)];
  const field = e.target.dataset.field;
  if (!field) return;
  if (field === "name") {
    if (e.target.tagName === "INPUT") {
      it.name = e.target.value;
      it.custom = true;
    }
    return;
  }
  it[field] = ["sets", "reps", "weight_kg", "rest_sec"].includes(field)
    ? Number(e.target.value)
    : e.target.value;
});

$("#plan-items").addEventListener("change", (e) => {
  const row = e.target.closest(".item-row");
  if (!row) return;
  const it = state.editing.items[Number(row.dataset.index)];
  const field = e.target.dataset.field;
  if (field === "muscle_group") {
    it.muscle_group = e.target.value;
    if (!it.custom) it.name = "";
    renderPlanItems();
  } else if (field === "name") {
    if (e.target.value === "__custom__") {
      it.custom = true;
      it.name = "";
    } else {
      it.custom = false;
      it.name = e.target.value;
    }
    renderPlanItems();
  }
});

$("#plan-items").addEventListener("click", (e) => {
  const open = e.target.dataset.wheelOpen;
  if (open !== undefined) {
    openWheel(Number(open));
    return;
  }
  const idx = e.target.dataset.remove;
  if (idx === undefined) return;
  state.editing.items.splice(Number(idx), 1);
  renderPlanItems();
});

/* ---------------- 组/次/重量 轮盘 ---------------- */
const WHEEL_ITEM_H = 40;
const WHEEL_FIELDS = ["sets", "reps", "weight_kg"];
const WHEEL_RANGES = {
  sets: { min: 1, max: 20, step: 1 },
  reps: { min: 1, max: 50, step: 1 },
  weight_kg: { min: 0, max: 300, step: 2.5 },
};
let wheelState = null;

function wheelValues(field) {
  const { min, max, step } = WHEEL_RANGES[field];
  const out = [];
  for (let v = min; v <= max + 1e-9; v += step) {
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}

function nearestIndex(values, target) {
  let idx = 0;
  let best = Infinity;
  values.forEach((v, i) => {
    const d = Math.abs(v - target);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  return idx;
}

function updateWheelActive(el, field) {
  const items = el.querySelectorAll(".wheel-item");
  const idx = Math.min(
    items.length - 1,
    Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H))
  );
  items.forEach((node, i) => node.classList.toggle("active", i === idx));
  if (wheelState && field) {
    wheelState.values[field] = wheelValues(field)[idx];
  }
}

function openWheel(index) {
  const it = state.editing.items[index];
  if (!it) return;
  wheelState = {
    index,
    values: { sets: it.sets, reps: it.reps, weight_kg: it.weight_kg },
  };
  $("#wheel-title").textContent = it.name || "选择数值";
  $("#wheel-wheels").innerHTML =
    `<div class="wheel-band"></div>` +
    WHEEL_FIELDS.map((field) => {
      const values = wheelValues(field);
      const items = values
        .map((v) => `<div class="wheel-item">${v}</div>`)
        .join("");
      return `<div class="wheel" data-wheel="${field}"><div class="wheel-spacer"></div>${items}<div class="wheel-spacer"></div></div>`;
    }).join("");
  openModal("wheel-modal");

  requestAnimationFrame(() => {
    WHEEL_FIELDS.forEach((field) => {
      const el = $(`#wheel-wheels .wheel[data-wheel="${field}"]`);
      if (!el) return;
      const values = wheelValues(field);
      el.scrollTop = nearestIndex(values, wheelState.values[field]) * WHEEL_ITEM_H;
      updateWheelActive(el, field);
      el.addEventListener("scroll", () => {
        clearTimeout(el._snap);
        el._snap = setTimeout(() => updateWheelActive(el, field), 90);
      });
    });
  });
}

$("#wheel-confirm").addEventListener("click", () => {
  if (!wheelState) return;
  const it = state.editing.items[wheelState.index];
  if (it) {
    it.sets = Number(wheelState.values.sets);
    it.reps = Number(wheelState.values.reps);
    it.weight_kg = Number(wheelState.values.weight_kg);
  }
  wheelState = null;
  closeModal("wheel-modal");
  renderPlanItems();
});

$("#add-item").addEventListener("click", () => {
  const group = groupNames()[0] || "";
  state.editing.items.push({
    name: exercisesFor(group)[0] || "",
    muscle_group: group,
    video_url: null,
    day_label: "第 1 天",
    sets: 3,
    reps: 10,
    weight_kg: 0,
    rest_sec: 60,
  });
  renderPlanItems();
});

$("#save-plan").addEventListener("click", async () => {
  const items = state.editing.items
    .filter((it) => (it.name || "").trim())
    .map((it, i) => {
      const { custom, ...rest } = it;
      return { ...rest, sort_order: i };
    });
  if (items.length === 0) return alert("请至少添加一个动作");
  const payload = {
    name: state.editing.name || autoPlanName(),
    goal: "",
    notes: null,
    items,
  };
  if (state.editing.id == null) {
    await call("create_plan", { input: payload });
  } else {
    await call("update_plan", { id: state.editing.id, input: payload });
  }
  closeModal("plan-modal");
  await loadPlans();
});

$("#plans-list").addEventListener("click", async (e) => {
  const { open, edit, delPlan } = e.target.dataset;
  if (delPlan) {
    if (!confirm("删除该计划？")) return;
    await call("delete_plan", { id: Number(delPlan) });
    await loadPlans();
  } else if (edit) {
    await startEditPlan(Number(edit));
  } else if (open) {
    await showPlanDetail(Number(open));
  }
});

async function startEditPlan(id) {
  const plan = await call("get_plan", { id });
  state.editing = {
    id: plan.id,
    name: plan.name,
    items: plan.items.map((it) => ({
      name: it.name,
      muscle_group: it.muscle_group,
      video_url: it.video_url ?? null,
      day_label: it.day_label,
      sets: it.sets,
      reps: it.reps,
      weight_kg: it.weight_kg,
      rest_sec: it.rest_sec,
    })),
  };
  $("#plan-modal-title").textContent = "编辑计划";
  renderPlanItems();
  openModal("plan-modal");
}

async function showPlanDetail(id) {
  const plan = await call("get_plan", { id });
  $("#detail-title").textContent = plan.name;
  const html = plan.items
    .map(
      (it) => `
      <div class="card" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div>
            <h3>${esc(it.name)}</h3>
            <div class="meta">${it.sets} 组 × ${it.reps} 次 · ${it.weight_kg} kg${
        it.muscle_group ? " · " + esc(it.muscle_group) : ""
      }</div>
          </div>
          ${
            it.video_url
              ? `<button class="ghost" data-video-url="${esc(
                  it.video_url
                )}" data-video-name="${esc(it.name)}">看演示</button>`
              : ""
          }
        </div>
      </div>`
    )
    .join("");
  $("#detail-body").innerHTML =
    html || `<p class="empty">该计划还没有动作。</p>`;
  openModal("detail-modal");
}

$("#detail-body").addEventListener("click", (e) => {
  const url = e.target.dataset.videoUrl;
  if (url) playVideo(e.target.dataset.videoName, url);
});

/* ---------------- 管理动作库 ---------------- */
function renderGroupList() {
  $("#lib-group-list").innerHTML = state.library.groups
    .map(
      (g, i) => `
      <div class="lib-row ${i === state.libSelected ? "active" : ""}" data-group-row="${i}">
        <input data-group-name="${i}" value="${esc(g.name)}" placeholder="部位名称" />
        <button class="remove" data-del-group="${i}" title="删除">✕</button>
      </div>`
    )
    .join("");
}

function renderExList() {
  const group = state.library.groups[state.libSelected];
  $("#lib-ex-title").textContent = group ? `动作 · ${group.name}` : "动作";
  $("#lib-ex-list").innerHTML = group
    ? group.exercises
        .map(
          (n, i) => `
      <div class="lib-row">
        <input data-ex-name="${i}" value="${esc(n)}" placeholder="动作名称" />
        <button class="remove" data-del-ex="${i}" title="删除">✕</button>
      </div>`
        )
        .join("")
    : `<p class="empty">还没有部位，先添加一个部位。</p>`;
}

function renderLibrary() {
  if (state.libSelected >= state.library.groups.length) {
    state.libSelected = Math.max(0, state.library.groups.length - 1);
  }
  renderGroupList();
  renderExList();
}

function selectGroup(i) {
  state.libSelected = i;
  $$("#lib-group-list .lib-row").forEach((r, idx) =>
    r.classList.toggle("active", idx === i)
  );
  renderExList();
}

$("#manage-library").addEventListener("click", () => {
  state.libSelected = 0;
  renderLibrary();
  openModal("library-modal");
});

$("#lib-add-group").addEventListener("click", async () => {
  state.library.groups.push({
    name: `部位${state.library.groups.length + 1}`,
    exercises: [],
  });
  state.libSelected = state.library.groups.length - 1;
  await saveLibrary();
  renderLibrary();
  const inputs = $$("#lib-group-list input");
  const last = inputs[inputs.length - 1];
  if (last) {
    last.focus();
    last.select();
  }
});

$("#lib-add-ex").addEventListener("click", async () => {
  const group = state.library.groups[state.libSelected];
  if (!group) return alert("请先添加一个部位");
  group.exercises.push(`动作${group.exercises.length + 1}`);
  await saveLibrary();
  renderExList();
  const inputs = $$("#lib-ex-list input");
  const last = inputs[inputs.length - 1];
  if (last) {
    last.focus();
    last.select();
  }
});

$("#lib-group-list").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-group-row]");
  if (!row) return;
  const i = Number(row.dataset.groupRow);
  const del = e.target.dataset.delGroup;
  if (del !== undefined) {
    if (!confirm("删除该部位及其动作？")) return;
    state.library.groups.splice(Number(del), 1);
    await saveLibrary();
    renderLibrary();
    return;
  }
  if (i !== state.libSelected) selectGroup(i);
});

$("#lib-group-list").addEventListener("focusin", (e) => {
  const row = e.target.closest("[data-group-row]");
  if (!row) return;
  const i = Number(row.dataset.groupRow);
  if (i !== state.libSelected) selectGroup(i);
});

$("#lib-group-list").addEventListener("change", async (e) => {
  const idx = e.target.dataset.groupName;
  if (idx === undefined) return;
  state.library.groups[Number(idx)].name = e.target.value.trim() || "未命名部位";
  await saveLibrary();
  renderExList();
});

$("#lib-ex-list").addEventListener("change", async (e) => {
  const idx = e.target.dataset.exName;
  if (idx === undefined) return;
  const group = state.library.groups[state.libSelected];
  if (!group) return;
  group.exercises[Number(idx)] = e.target.value.trim() || "未命名动作";
  await saveLibrary();
});

$("#lib-ex-list").addEventListener("click", async (e) => {
  const del = e.target.dataset.delEx;
  if (del === undefined) return;
  const group = state.library.groups[state.libSelected];
  if (!group) return;
  group.exercises.splice(Number(del), 1);
  await saveLibrary();
  renderExList();
});

/* ---------------- 启动 ---------------- */
(async function init() {
  await loadLibrary();
  await loadPlans();
})();
