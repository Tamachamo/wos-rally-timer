(() => {
  const cityListEl = document.getElementById("cityList");
  const addCityBtn = document.getElementById("addCityBtn");
  const startAllBtn = document.getElementById("startAllBtn");
  const resetAllBtn = document.getElementById("resetAllBtn");
  const myMarchListEl = document.getElementById("myMarchList");
  const addMyMarchBtn = document.getElementById("addMyMarchBtn");
  const copyViewUrlBtn = document.getElementById("copyViewUrlBtn");
  const copyEditUrlBtn = document.getElementById("copyEditUrlBtn");
  const newRoomBtn = document.getElementById("newRoomBtn");
  const roomIdDisplay = document.getElementById("roomIdDisplay");
  const syncStatusEl = document.getElementById("syncStatus");
  const modeBadgeEl = document.getElementById("modeBadge");
  const editShareActionsEl = document.getElementById("editShareActions");
  const editToolbarEl = document.getElementById("editToolbar");
  const headerSubtitleEl = document.getElementById("headerSubtitle");

  let cities = [];
  let myMarches = [];
  let lastSyncedUpdatedAt = 0;
  let lastLocalMutationAt = 0;
  let isSyncing = false;
  let isDragging = false;
  let debounceTimer = null;

  // 1. 部屋IDとモード（編集 or 見るだけ）の取得
  function generateRoomId() {
    return Math.random().toString(36).substring(2, 8);
  }

  const url = new URL(window.location.href);
  let roomId = url.searchParams.get("room");
  const isViewMode = url.searchParams.get("mode") === "view";

  if (!roomId) {
    roomId = generateRoomId();
    url.searchParams.set("room", roomId);
    window.history.replaceState({}, "", url.toString());
  }
  roomIdDisplay.textContent = roomId;

  if (isViewMode) {
    modeBadgeEl.textContent = "👀 見るだけモード（閲覧専用）";
    modeBadgeEl.classList.add("view-only");
    headerSubtitleEl.textContent = "開始された集結が着弾の早い順に表示されます。自分の行軍時間を登録してください。";
    editShareActionsEl.style.display = "none";
    editToolbarEl.style.display = "none";
  }

  // 2. 自分の行軍時間（複数登録・各自の端末localStorageに保存）
  const MY_MARCHES_STORAGE_KEY = "wos_my_marches_v2";
  const LEGACY_MARCH_KEY = "wos_my_march_time";

  function makeMyMarchObj(name = "", min = 0, sec = 0) {
    return {
      id: "m_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      name: name || `行軍 ${myMarches.length + 1}`,
      min,
      sec
    };
  }

  function loadMyMarches() {
    try {
      const saved = JSON.parse(localStorage.getItem(MY_MARCHES_STORAGE_KEY));
      if (Array.isArray(saved) && saved.length > 0) {
        myMarches = saved;
      } else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_MARCH_KEY));
        if (legacy && (legacy.min > 0 || legacy.sec > 0)) {
          myMarches = [makeMyMarchObj("行軍 1", legacy.min || 0, legacy.sec || 0)];
        } else {
          myMarches = [makeMyMarchObj("行軍 1", 0, 0)];
        }
      }
    } catch (_) {
      myMarches = [makeMyMarchObj("行軍 1", 0, 0)];
    }
    renderMyMarches();
  }

  function saveMyMarches() {
    localStorage.setItem(MY_MARCHES_STORAGE_KEY, JSON.stringify(myMarches));
    updateDisplay();
  }

  function renderMyMarches() {
    myMarchListEl.innerHTML = "";
    myMarches.forEach((march) => {
      const row = document.createElement("div");
      row.className = "my-march-item";
      row.innerHTML = `
        <input type="text" class="my-march-name" value="${escapeHtml(march.name)}" placeholder="部隊名など" />
        <div class="time-inputs">
          <label><input type="number" class="my-march-min" min="0" max="99" value="${march.min}" /> 分</label>
          <label><input type="number" class="my-march-sec" min="0" max="59" value="${march.sec}" /> 秒</label>
        </div>
        <button class="btn btn-danger btn-sm btn-delete-march">削除</button>
      `;

      const nameEl = row.querySelector(".my-march-name");
      const minEl = row.querySelector(".my-march-min");
      const secEl = row.querySelector(".my-march-sec");
      const delBtn = row.querySelector(".btn-delete-march");

      nameEl.addEventListener("input", () => {
        march.name = nameEl.value;
        saveMyMarches();
      });

      const updateTime = () => {
        march.min = Math.max(0, parseInt(minEl.value, 10) || 0);
        march.sec = Math.max(0, parseInt(secEl.value, 10) || 0);
        saveMyMarches();
      };
      minEl.addEventListener("input", updateTime);
      secEl.addEventListener("input", updateTime);

      delBtn.addEventListener("click", () => {
        if (myMarches.length <= 1) {
          march.min = 0;
          march.sec = 0;
          renderMyMarches();
          saveMyMarches();
        } else {
          myMarches = myMarches.filter((m) => m.id !== march.id);
          renderMyMarches();
          saveMyMarches();
        }
      });

      myMarchListEl.appendChild(row);
    });
  }

  addMyMarchBtn.addEventListener("click", () => {
    myMarches.push(makeMyMarchObj());
    renderMyMarches();
    saveMyMarches();
  });

  function getActiveMyMarches() {
    return myMarches
      .map((m) => ({
        id: m.id,
        name: (m.name || "").trim() || "行軍",
        totalSec: Math.max(0, m.min) * 60 + Math.max(0, m.sec)
      }))
      .filter((m) => m.totalSec > 0);
  }

  // 3. 共有状態（cities）をサーバーへ即座に保存（編集モードのみ）
  async function pushStateToServer() {
    if (isViewMode) return;
    clearTimeout(debounceTimer);
    const now = Date.now();
    lastLocalMutationAt = now;
    lastSyncedUpdatedAt = now;
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cities, updatedAt: now })
      });
      if (!res.ok) throw new Error("Save failed");
      setSyncStatus(true);
    } catch (err) {
      setSyncStatus(false);
    }
  }

  function schedulePushState() {
    if (isViewMode) return;
    lastLocalMutationAt = Date.now();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      pushStateToServer();
    }, 300);
  }

  // 4. サーバーから最新の共有状態を取得（1秒ごとに自動同期）
  async function pullStateFromServer(isInitial = false) {
    if (isSyncing || isDragging) return;
    isSyncing = true;
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(roomId)}`);
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      setSyncStatus(true);

      if (data.cities === null) {
        if (isInitial && !isViewMode) {
          cities = [makeCityObj("集結 A"), makeCityObj("集結 B")];
          renderCities();
          await pushStateToServer();
        } else if (isInitial && isViewMode) {
          cities = [];
          renderCities();
        }
      } else if (
        data.updatedAt > lastSyncedUpdatedAt &&
        Date.now() - lastLocalMutationAt > 600
      ) {
        const activeEl = document.activeElement;
        const isTypingCard =
          !isViewMode &&
          activeEl?.tagName === "INPUT" &&
          activeEl.closest(".city-card") !== null;

        cities = data.cities;
        lastSyncedUpdatedAt = data.updatedAt;
        if (!isTypingCard && !isDragging) {
          renderCities();
        }
      }
    } catch (err) {
      setSyncStatus(false);
    } finally {
      isSyncing = false;
    }
  }

  function setSyncStatus(ok) {
    if (ok) {
      syncStatusEl.textContent = "🟢 ルーム同期中";
      syncStatusEl.classList.remove("error");
    } else {
      syncStatusEl.textContent = "⚠️ 同期エラー（D1設定を確認）";
      syncStatusEl.classList.add("error");
    }
  }

  // ユーティリティ
  function formatTime(totalSeconds, showDecimal = true) {
    if (totalSeconds <= 0) return showDecimal ? "00:00.0" : "00:00";
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    const minStr = String(mins).padStart(2, "0");
    if (showDecimal) {
      return `${minStr}:${secs.toFixed(1).padStart(4, "0")}`;
    }
    return `${minStr}:${String(Math.floor(secs)).padStart(2, "0")}`;
  }

  function makeCityObj(name = "") {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      name: name || `都市 ${cities.length + 1}`,
      marchMin: 0,
      marchSec: 30,
      waitMin: 5,
      waitSec: 0,
      isRunning: false,
      startTimestamp: null,
      initialTotalWaitSec: 300,
      pausedRemainingWaitSec: 300
    };
  }

  function getConfiguredWaitSec(city) {
    return Math.max(0, city.waitMin) * 60 + Math.max(0, city.waitSec);
  }

  function getConfiguredMarchSec(city) {
    return Math.max(0, city.marchMin) * 60 + Math.max(0, city.marchSec);
  }

  function calcCityTimes(city, now) {
    const marchSec = getConfiguredMarchSec(city);
    let currentWaitSec = city.pausedRemainingWaitSec;
    let elapsedAfterWait = 0;

    if (city.isRunning && city.startTimestamp !== null) {
      const elapsed = (now - city.startTimestamp) / 1000;
      const diff = city.initialTotalWaitSec - elapsed;
      if (diff >= 0) {
        currentWaitSec = diff;
      } else {
        currentWaitSec = 0;
        elapsedAfterWait = Math.abs(diff);
      }
    }

    const remainingMarchSec = Math.max(0, marchSec - elapsedAfterWait);
    const arrivalRemainingSec = currentWaitSec + remainingMarchSec;
    return { currentWaitSec, arrivalRemainingSec };
  }

  function addCity() {
    cities.push(makeCityObj());
    renderCities();
    pushStateToServer();
  }

  function deleteCity(id) {
    cities = cities.filter((c) => c.id !== id);
    renderCities();
    pushStateToServer();
  }

  function toggleStartCity(id) {
    const city = cities.find((c) => c.id === id);
    if (!city) return;

    if (city.isRunning) {
      const elapsed = (Date.now() - city.startTimestamp) / 1000;
      city.pausedRemainingWaitSec = Math.max(0, city.initialTotalWaitSec - elapsed);
      city.isRunning = false;
      city.startTimestamp = null;
    } else {
      if (city.pausedRemainingWaitSec <= 0) {
        city.pausedRemainingWaitSec = getConfiguredWaitSec(city);
      }
      city.initialTotalWaitSec = city.pausedRemainingWaitSec;
      city.startTimestamp = Date.now();
      city.isRunning = true;
    }
    renderCities();
    pushStateToServer();
  }

  function resetCity(id) {
    const city = cities.find((c) => c.id === id);
    if (!city) return;
    city.isRunning = false;
    city.startTimestamp = null;
    city.pausedRemainingWaitSec = getConfiguredWaitSec(city);
    city.initialTotalWaitSec = city.pausedRemainingWaitSec;
    renderCities();
    pushStateToServer();
  }

  // 5. 編集画面用：自由に動かせるドラッグ並び替え（ゴースト追従＋自動スクロール）
  function attachDragHandler(handle, card) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();

      isDragging = true;
      document.body.classList.add("is-dragging-any");

      const pointerId = e.pointerId;
      const startRect = card.getBoundingClientRect();
      const offsetX = e.clientX - startRect.left;
      const offsetY = e.clientY - startRect.top;

      // マウス/指に追従する浮遊クローンを作成
      const ghost = card.cloneNode(true);
      ghost.classList.remove("is-drag-placeholder");
      ghost.classList.add("drag-ghost");
      ghost.style.width = `${startRect.width}px`;
      ghost.style.height = `${startRect.height}px`;
      ghost.style.transform = `translate3d(${startRect.left}px, ${startRect.top}px, 0) scale(1.02)`;
      document.body.appendChild(ghost);

      // 元のカードは移動先の青い破線プレースホルダーにする
      card.classList.add("is-drag-placeholder");

      let pointerX = e.clientX;
      let pointerY = e.clientY;
      let scrollRafId = null;

      // 現在のポインター位置から最も自然な挿入位置を計算して入れ替え
      const reorderPlaceholder = (x, y) => {
        const allCards = Array.from(cityListEl.querySelectorAll(".city-card"));
        if (allCards.length <= 1) return;

        // 1. ポインターが他のカードの矩形内にあるか確認
        let targetCard = null;
        for (const other of allCards) {
          if (other === card) continue;
          const r = other.getBoundingClientRect();
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
            targetCard = other;
            break;
          }
        }

        // 2. 隙間や余白にある場合は、最も近いカードとの位置関係で先頭・末尾などへ移動
        if (!targetCard) {
          const first = allCards[0];
          const last = allCards[allCards.length - 1];
          const firstRect = first.getBoundingClientRect();
          const lastRect = last.getBoundingClientRect();

          if (y < firstRect.top || (y <= firstRect.bottom && x < firstRect.left)) {
            if (first !== card) first.before(card);
            return;
          }
          if (y > lastRect.bottom || (y >= lastRect.top && x > lastRect.right)) {
            if (last !== card) last.after(card);
            return;
          }
          return;
        }

        const currentIndex = allCards.indexOf(card);
        const targetIndex = allCards.indexOf(targetCard);
        if (currentIndex < targetIndex) {
          targetCard.after(card);
        } else {
          targetCard.before(card);
        }
      };

      // 画面の上下端での自動スクロール
      const autoScrollLoop = () => {
        if (!isDragging) return;
        const edge = 70;
        const maxSpeed = 14;
        let dy = 0;

        if (pointerY < edge) {
          dy = -Math.ceil(((edge - pointerY) / edge) * maxSpeed);
        } else if (pointerY > window.innerHeight - edge) {
          dy = Math.ceil(((pointerY - (window.innerHeight - edge)) / edge) * maxSpeed);
        }

        if (dy !== 0) {
          window.scrollBy(0, dy);
          reorderPlaceholder(pointerX, pointerY);
        }
        scrollRafId = requestAnimationFrame(autoScrollLoop);
      };
      scrollRafId = requestAnimationFrame(autoScrollLoop);

      const onPointerMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        pointerX = moveEvent.clientX;
        pointerY = moveEvent.clientY;

        ghost.style.transform = `translate3d(${pointerX - offsetX}px, ${pointerY - offsetY}px, 0) scale(1.02)`;
        reorderPlaceholder(pointerX, pointerY);
      };

      const finishDrag = (endEvent) => {
        if (endEvent && endEvent.pointerId !== undefined && endEvent.pointerId !== pointerId) {
          return;
        }

        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishDrag);
        window.removeEventListener("pointercancel", finishDrag);
        window.removeEventListener("blur", finishDrag);

        if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
        if (ghost.parentNode) ghost.parentNode.removeChild(ghost);

        card.classList.remove("is-drag-placeholder");
        document.body.classList.remove("is-dragging-any");
        isDragging = false;

        // DOMの新しい並び順から cities 配列を更新
        const orderedIds = Array.from(cityListEl.querySelectorAll(".city-card")).map(
          (el) => el.dataset.id
        );
        const cityMap = new Map(cities.map((c) => [c.id, c]));
        cities = orderedIds.map((id) => cityMap.get(id)).filter(Boolean);

        // 枠の色や表示を即座に再反映し、サーバーへ同期
        updateDisplay();
        pushStateToServer();
      };

      // window に登録することで DOM 移動中も絶対にイベントが途切れない
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishDrag);
      window.addEventListener("pointercancel", finishDrag);
      window.addEventListener("blur", finishDrag);
    });
  }

  function renderCities() {
    cityListEl.innerHTML = "";

    const targetCities = isViewMode
      ? cities.filter((c) => c.isRunning)
      : cities;

    if (isViewMode && targetCities.length === 0) {
      cityListEl.innerHTML = `
        <div class="empty-state">
          現在カウントダウン中の集結はありません。<br />
          指揮官がカウントを開始すると自動で表示されます。
        </div>
      `;
      return;
    }

    targetCities.forEach((city) => {
      const card = document.createElement("div");
      card.className = "city-card";
      card.dataset.id = city.id;

      if (isViewMode) {
        // 【見るだけページ用】
        card.innerHTML = `
          <div class="card-top">
            <span class="city-title-view">${escapeHtml(city.name)}</span>
            <span class="status-badge" data-role="status">待機中</span>
          </div>

          <div class="result-panel">
            <div class="arrival-row">
              <span class="arrival-label">相手の集結着弾まで</span>
              <span class="arrival-time" data-role="arrival">--:--.-</span>
            </div>
            <div class="launch-list" data-role="launch-list"></div>
          </div>
        `;
      } else {
        // 【編集ページ用】ドラッグハンドル付き
        card.innerHTML = `
          <div class="card-top">
            <span class="drag-handle" title="ドラッグして並び替え">☰</span>
            <input type="text" class="city-name-input" value="${escapeHtml(city.name)}" placeholder="都市名・集結主名" />
            <button class="btn btn-danger btn-sm delete-btn">削除</button>
          </div>

          <div class="input-group">
            <div class="input-label"><span>① 行軍時間（相手の移動時間）</span></div>
            <div class="time-inputs">
              <label><input type="number" class="march-min" min="0" max="99" value="${city.marchMin}" /> 分</label>
              <label><input type="number" class="march-sec" min="0" max="59" value="${city.marchSec}" /> 秒</label>
            </div>
          </div>

          <div class="input-group">
            <div class="input-label"><span>② 行軍開始までの待ち時間（集結残り時間）</span></div>
            <div class="time-inputs">
              <label><input type="number" class="wait-min" min="0" max="99" value="${city.waitMin}" ${city.isRunning ? "disabled" : ""} /> 分</label>
              <label><input type="number" class="wait-sec" min="0" max="59" value="${city.waitSec}" ${city.isRunning ? "disabled" : ""} /> 秒</label>
            </div>
          </div>

          <div class="result-panel">
            <span class="status-badge" data-role="status">待機中</span>
            <div class="arrival-row">
              <span class="arrival-label">集結到着まで</span>
              <span class="arrival-time" data-role="arrival">--:--.-</span>
            </div>
            <div class="sub-row">
              <span>出発までの残り待ち時間</span>
              <strong data-role="wait-rem">--:--.-</strong>
            </div>
            <div class="launch-list" data-role="launch-list"></div>
          </div>

          <div class="card-actions">
            <button class="btn ${city.isRunning ? "btn-warning" : "btn-success"} start-btn">
              ${city.isRunning ? "❚❚ 一時停止" : "▶ スタート"}
            </button>
            <button class="btn btn-secondary reset-btn">↺ リセット</button>
          </div>
        `;

        const dragHandle = card.querySelector(".drag-handle");
        attachDragHandler(dragHandle, card);

        const nameInput = card.querySelector(".city-name-input");
        nameInput.addEventListener("input", (e) => {
          city.name = e.target.value;
          schedulePushState();
        });

        const marchMinInput = card.querySelector(".march-min");
        const marchSecInput = card.querySelector(".march-sec");
        const syncMarch = () => {
          city.marchMin = Math.max(0, parseInt(marchMinInput.value, 10) || 0);
          city.marchSec = Math.max(0, parseInt(marchSecInput.value, 10) || 0);
          schedulePushState();
        };
        marchMinInput.addEventListener("input", syncMarch);
        marchSecInput.addEventListener("input", syncMarch);

        const waitMinInput = card.querySelector(".wait-min");
        const waitSecInput = card.querySelector(".wait-sec");
        const syncWait = () => {
          city.waitMin = Math.max(0, parseInt(waitMinInput.value, 10) || 0);
          city.waitSec = Math.max(0, parseInt(waitSecInput.value, 10) || 0);
          if (!city.isRunning) {
            city.pausedRemainingWaitSec = getConfiguredWaitSec(city);
            city.initialTotalWaitSec = city.pausedRemainingWaitSec;
          }
          schedulePushState();
        };
        waitMinInput.addEventListener("input", syncWait);
        waitSecInput.addEventListener("input", syncWait);

        card.querySelector(".start-btn").addEventListener("click", () => toggleStartCity(city.id));
        card.querySelector(".reset-btn").addEventListener("click", () => resetCity(city.id));
        card.querySelector(".delete-btn").addEventListener("click", () => deleteCity(city.id));
      }

      cityListEl.appendChild(card);
    });

    updateDisplay();
  }

  function updateCardLaunchList(launchListEl, activeMarches, arrivalRemainingSec) {
    if (activeMarches.length === 0) {
      if (isViewMode) {
        if (!launchListEl.querySelector(".launch-placeholder")) {
          launchListEl.innerHTML = `<div class="launch-placeholder">上で自分の行軍時間を入力すると発射時間を計算します</div>`;
        }
      } else {
        if (launchListEl.innerHTML !== "") launchListEl.innerHTML = "";
      }
      return;
    }

    const signature = activeMarches.map((m) => `${m.id}:${m.name}`).join("|");
    if (launchListEl.dataset.sig !== signature) {
      launchListEl.dataset.sig = signature;
      launchListEl.innerHTML = activeMarches
        .map(
          (m) => `
          <div class="launch-alert ${isViewMode ? "view-mode-launch" : ""}" data-march-id="${m.id}">
            <span class="launch-label">${escapeHtml(m.name)} (${formatTime(m.totalSec, false)})</span>
            <span class="launch-val">--:--.-</span>
          </div>
        `
        )
        .join("");
    }

    activeMarches.forEach((m) => {
      const box = launchListEl.querySelector(`.launch-alert[data-march-id="${m.id}"]`);
      if (!box) return;
      const valEl = box.querySelector(".launch-val");
      const launchDiff = arrivalRemainingSec - m.totalSec;

      if (arrivalRemainingSec <= 0) {
        box.classList.remove("launch-now");
        valEl.textContent = "着弾済み";
      } else if (launchDiff > 0) {
        box.classList.remove("launch-now");
        valEl.textContent = `あと ${formatTime(launchDiff, true)}`;
      } else if (launchDiff > -3) {
        box.classList.add("launch-now");
        valEl.textContent = "🔥 今すぐ発射！";
      } else {
        box.classList.remove("launch-now");
        valEl.textContent = `${Math.abs(launchDiff).toFixed(1)}秒遅れ`;
      }
    });
  }

  function updateDisplay() {
    const now = Date.now();
    const activeMarches = getActiveMyMarches();

    const targetCities = isViewMode
      ? cities.filter((c) => c.isRunning)
      : cities;

    const computed = targetCities.map((city) => ({
      city,
      ...calcCityTimes(city, now)
    }));

    // 【見るだけモード】着弾時間が早い順に自動並び替え（着弾完了は末尾へ）
    if (isViewMode && computed.length > 1) {
      computed.sort((a, b) => {
        const aArrived = a.arrivalRemainingSec <= 0;
        const bArrived = b.arrivalRemainingSec <= 0;
        if (aArrived !== bArrived) return aArrived ? 1 : -1;
        return a.arrivalRemainingSec - b.arrivalRemainingSec;
      });

      const currentDomIds = Array.from(cityListEl.querySelectorAll(".city-card")).map(
        (el) => el.dataset.id
      );
      const desiredIds = computed.map((item) => item.city.id);

      const orderChanged =
        currentDomIds.length === desiredIds.length &&
        desiredIds.some((id, idx) => currentDomIds[idx] !== id);

      if (orderChanged) {
        desiredIds.forEach((id) => {
          const cardEl = cityListEl.querySelector(`.city-card[data-id="${id}"]`);
          if (cardEl) cityListEl.appendChild(cardEl);
        });
      }
    }

    computed.forEach(({ city, currentWaitSec, arrivalRemainingSec }) => {
      const card = cityListEl.querySelector(`.city-card[data-id="${city.id}"]`);
      if (!card) return;

      const statusEl = card.querySelector('[data-role="status"]');
      const arrivalEl = card.querySelector('[data-role="arrival"]');
      const waitRemEl = card.querySelector('[data-role="wait-rem"]');
      const launchListEl = card.querySelector('[data-role="launch-list"]');

      card.classList.remove("is-running", "is-marching", "is-arrived");
      statusEl.className = "status-badge";

      if (!city.isRunning && currentWaitSec === getConfiguredWaitSec(city)) {
        statusEl.textContent = "待機中（未開始）";
      } else if (!city.isRunning) {
        statusEl.textContent = "一時停止中";
      } else if (currentWaitSec > 0) {
        statusEl.textContent = "集結待機中";
        statusEl.classList.add("status-waiting");
        card.classList.add("is-running");
      } else if (arrivalRemainingSec > 0) {
        statusEl.textContent = "⚔️ 行軍中！";
        statusEl.classList.add("status-marching");
        card.classList.add("is-marching");
      } else {
        statusEl.textContent = "💥 着弾完了";
        statusEl.classList.add("status-arrived");
        card.classList.add("is-arrived");
      }

      arrivalEl.textContent = formatTime(arrivalRemainingSec, true);
      if (waitRemEl) {
        waitRemEl.textContent = formatTime(currentWaitSec, true);
      }

      updateCardLaunchList(launchListEl, activeMarches, arrivalRemainingSec);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildShareUrl(mode) {
    const shareUrl = new URL(window.location.origin + window.location.pathname);
    shareUrl.searchParams.set("room", roomId);
    if (mode === "view") {
      shareUrl.searchParams.set("mode", "view");
    }
    return shareUrl.toString();
  }

  if (!isViewMode) {
    addCityBtn.addEventListener("click", addCity);

    startAllBtn.addEventListener("click", () => {
      const now = Date.now();
      cities.forEach((city) => {
        if (!city.isRunning) {
          if (city.pausedRemainingWaitSec <= 0) {
            city.pausedRemainingWaitSec = getConfiguredWaitSec(city);
          }
          city.initialTotalWaitSec = city.pausedRemainingWaitSec;
          city.startTimestamp = now;
          city.isRunning = true;
        }
      });
      renderCities();
      pushStateToServer();
    });

    resetAllBtn.addEventListener("click", () => {
      cities.forEach((city) => {
        city.isRunning = false;
        city.startTimestamp = null;
        city.pausedRemainingWaitSec = getConfiguredWaitSec(city);
        city.initialTotalWaitSec = city.pausedRemainingWaitSec;
      });
      renderCities();
      pushStateToServer();
    });

    copyViewUrlBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(buildShareUrl("view"));
      const original = copyViewUrlBtn.textContent;
      copyViewUrlBtn.textContent = "✅ 見るだけURLをコピーしました！";
      setTimeout(() => {
        copyViewUrlBtn.textContent = original;
      }, 2000);
    });

    copyEditUrlBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(buildShareUrl("edit"));
      const original = copyEditUrlBtn.textContent;
      copyEditUrlBtn.textContent = "✅ 編集URLをコピーしました！";
      setTimeout(() => {
        copyEditUrlBtn.textContent = original;
      }, 2000);
    });

    newRoomBtn.addEventListener("click", () => {
      const nextUrl = new URL(window.location.origin + window.location.pathname);
      nextUrl.searchParams.set("room", generateRoomId());
      window.location.href = nextUrl.toString();
    });
  }

  loadMyMarches();
  pullStateFromServer(true);
  setInterval(updateDisplay, 100);
  setInterval(() => pullStateFromServer(false), 1000);
})();
