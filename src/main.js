const tauriCore = window.__TAURI__ && window.__TAURI__.core;
const isTauri = !!(tauriCore && typeof tauriCore.invoke === "function");
const invoke = isTauri ? tauriCore.invoke : (cmd, args) => window.FitnessDB.call(cmd, args);
const convertFileSrc =
  isTauri && tauriCore.convertFileSrc ? tauriCore.convertFileSrc : (p) => p;

const state = {
  exercises: [],
  plans: [],
  editing: { id: null, items: [] },
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

/* ---------------- 视图切换 ---------------- */
$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    const view = tab.dataset.view;
    $$(".view").forEach((v) =>
      v.classList.toggle("active", v.id === `view-${view}`)
    );
  });
});

/* ---------------- 弹层 ---------------- */
function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
}
function closeModal(id) {
  if (id === "video-modal") $("#video-body").innerHTML = "";
  $(`#${id}`).classList.add("hidden");
}
$$("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => closeModal(btn.dataset.close))
);
$$(".overlay").forEach((ov) =>
  ov.addEventListener("click", (e) => {
    if (e.target === ov) closeModal(ov.id);
  })
);

/* ---------------- 动作库 ---------------- */
async function loadExercises() {
  state.exercises = await call("list_exercises");
  renderExercises();
}

function renderExercises() {
  const list = $("#exercises-list");
  const empty = $("#exercises-empty");
  list.innerHTML = state.exercises
    .map(
      (ex) => `
      <div class="card">
        <h3>${esc(ex.name)}</h3>
        <div class="meta">${esc(ex.muscle_group || "未分类")}</div>
        ${ex.video_url ? `<span class="tag">有视频</span>` : ""}
        <div class="row">
          ${
            ex.video_url
              ? `<button class="ghost" data-video="${ex.id}">看演示</button>`
              : ""
          }
          <button class="ghost" data-del-ex="${ex.id}">删除</button>
        </div>
      </div>`
    )
    .join("");
  empty.classList.toggle("hidden", state.exercises.length > 0);
}

$("#add-exercise").addEventListener("click", async () => {
  const name = $("#ex-name").value.trim();
  if (!name) return alert("请填写动作名称");
  await call("create_exercise", {
    input: {
      name,
      muscle_group: $("#ex-group").value.trim(),
      video_url: $("#ex-video").value.trim() || null,
      notes: null,
    },
  });
  $("#ex-name").value = "";
  $("#ex-group").value = "";
  $("#ex-video").value = "";
  await loadExercises();
});

$("#exercises-list").addEventListener("click", async (e) => {
  const delId = e.target.dataset.delEx;
  const vidId = e.target.dataset.video;
  if (delId) {
    if (!confirm("删除该动作？")) return;
    await call("delete_exercise", { id: Number(delId) });
    await loadExercises();
  } else if (vidId) {
    const ex = state.exercises.find((x) => x.id === Number(vidId));
    if (ex) playVideo(ex.name, ex.video_url);
  }
});

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
  } else if (!isTauri && !/^https?:\/\//i.test(url)) {
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
        <div class="meta">${esc(p.goal || "未设置目标")}</div>
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

$("#new-plan").addEventListener("click", () => {
  state.editing = { id: null, items: [] };
  $("#plan-modal-title").textContent = "新建计划";
  $("#plan-name").value = "";
  $("#plan-goal").value = "";
  $("#plan-notes").value = "";
  renderPlanItems();
  openModal("plan-modal");
});

function renderPlanItems() {
  const wrap = $("#plan-items");
  wrap.innerHTML =
    `<div class="item-head"><span>动作</span><span>训练日</span><span>组</span><span>次</span><span>重量kg</span><span>休息s</span><span></span></div>` +
    state.editing.items
      .map(
        (it, i) => `
    <div class="item-row" data-index="${i}">
      <select data-field="exercise_id">
        ${state.exercises
          .map(
            (ex) =>
              `<option value="${ex.id}" ${
                ex.id === it.exercise_id ? "selected" : ""
              }>${esc(ex.name)}</option>`
          )
          .join("")}
      </select>
      <input data-field="day_label" value="${esc(it.day_label)}" />
      <input data-field="sets" type="number" min="1" value="${it.sets}" />
      <input data-field="reps" type="number" min="1" value="${it.reps}" />
      <input data-field="weight_kg" type="number" step="0.5" min="0" value="${
        it.weight_kg
      }" />
      <input data-field="rest_sec" type="number" min="0" value="${it.rest_sec}" />
      <button class="remove" data-remove="${i}" title="移除">✕</button>
    </div>`
      )
      .join("");
  $("#items-empty").classList.toggle("hidden", state.editing.items.length > 0);
}

$("#plan-items").addEventListener("input", (e) => {
  const row = e.target.closest(".item-row");
  if (!row) return;
  const it = state.editing.items[Number(row.dataset.index)];
  const field = e.target.dataset.field;
  if (!field) return;
  it[field] = ["sets", "reps", "weight_kg", "rest_sec", "exercise_id"].includes(
    field
  )
    ? Number(e.target.value)
    : e.target.value;
});

$("#plan-items").addEventListener("click", (e) => {
  const idx = e.target.dataset.remove;
  if (idx === undefined) return;
  state.editing.items.splice(Number(idx), 1);
  renderPlanItems();
});

$("#add-item").addEventListener("click", () => {
  if (state.exercises.length === 0) {
    return alert("请先到「动作库」添加动作。");
  }
  state.editing.items.push({
    exercise_id: state.exercises[0].id,
    day_label: "第 1 天",
    sets: 3,
    reps: 10,
    weight_kg: 0,
    rest_sec: 60,
  });
  renderPlanItems();
});

$("#save-plan").addEventListener("click", async () => {
  const name = $("#plan-name").value.trim();
  if (!name) return alert("请填写计划名称");
  const payload = {
    name,
    goal: $("#plan-goal").value.trim(),
    notes: $("#plan-notes").value.trim() || null,
    items: state.editing.items.map((it, i) => ({ ...it, sort_order: i })),
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
    items: plan.items.map((it) => ({
      exercise_id: it.exercise_id,
      day_label: it.day_label,
      sets: it.sets,
      reps: it.reps,
      weight_kg: it.weight_kg,
      rest_sec: it.rest_sec,
    })),
  };
  $("#plan-modal-title").textContent = "编辑计划";
  $("#plan-name").value = plan.name;
  $("#plan-goal").value = plan.goal;
  $("#plan-notes").value = plan.notes || "";
  renderPlanItems();
  openModal("plan-modal");
}

async function showPlanDetail(id) {
  const plan = await call("get_plan", { id });
  $("#detail-title").textContent = plan.name;
  const days = {};
  plan.items.forEach((it) => {
    (days[it.day_label] ||= []).push(it);
  });
  const html = Object.entries(days)
    .map(
      ([day, items]) => `
      <div>
        <h3 class="items-head">${esc(day)}</h3>
        ${items
          .map(
            (it) => `
          <div class="card" style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
              <div>
                <h3>${esc(it.exercise_name)}</h3>
                <div class="meta">${it.sets} 组 × ${it.reps} 次 · ${
              it.weight_kg
            } kg · 休息 ${it.rest_sec}s${
              it.muscle_group ? " · " + esc(it.muscle_group) : ""
            }</div>
              </div>
              ${
                it.video_url
                  ? `<button class="ghost" data-video-url="${esc(
                      it.video_url
                    )}" data-video-name="${esc(it.exercise_name)}">看演示</button>`
                  : ""
              }
            </div>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
  $("#detail-body").innerHTML =
    `<div class="meta">目标：${esc(plan.goal || "未设置")}${
      plan.notes ? " · " + esc(plan.notes) : ""
    }</div>` + (html || `<p class="empty">该计划还没有动作。</p>`);
  openModal("detail-modal");
}

$("#detail-body").addEventListener("click", (e) => {
  const url = e.target.dataset.videoUrl;
  if (url) playVideo(e.target.dataset.videoName, url);
});

/* ---------------- 启动 ---------------- */
(async function init() {
  await loadExercises();
  await loadPlans();
})();
