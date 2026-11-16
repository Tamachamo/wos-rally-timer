(() => {
  const cityListEl = document.getElementById("cityList");
  const addCityBtn = document.getElementById("addCityBtn");
  const startAllBtn = document.getElementById("startAllBtn");
  const resetAllBtn = document.getElementById("resetAllBtn");
  const myMarchMinEl = document.getElementById("myMarchMin");
  const myMarchSecEl = document.getElementById("myMarchSec");
  const clearMyMarchBtn = document.getElementById("clearMyMarch");
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
  let lastSyncedUpdatedAt = 0;
  let lastLocalMutationAt = 0;
  let isSyncing = false;
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

  // 見るだけモード時のUI切り替え
  if (isViewMode) {
    modeBadgeEl.textContent = "👀 見るだけモード（閲覧専用）";
    modeBadgeEl.classList.add("view-only");
    headerSubtitleEl.textContent = "自分の行軍時間を入力すると、開始された集結の発射タイミングを自動計算します";
    editShareActionsEl.style.display = "none";
    editToolbarEl.style.display = "none";
  }

  // 2. 自分の行軍時間は各自の端末（localStorage）に保存
  const MY_MARCH_STORAGE_KEY = "wos_my_march_time";
  function loadMyMarchTime() {
    try {
      const saved = JSON.parse(localStorage.getItem(MY_MARCH_STORAGE_KEY));
      if (saved) {
        myMarchMinEl.value = saved.min || 0;
        myMarchSecEl.value = saved.sec || 0;
      }
    } catch (_) {}
  }

  function saveMyMarchTime() {
    const min = Math.max(0, parseInt(myMarchMinEl.value, 10) || 0);
    const sec = Math.max(0, parseInt(myMarchSecEl.value, 10) || 0);
    localStorage.setItem(MY_MARCH_STORAGE_KEY, JSON.stringify({ min, sec }));
    updateDisplay();
  }

  myMarchMinEl.addEventListener("input", saveMyMarchTime);
  myMarchSecEl.addEventListener("input", saveMyMarchTime);
  clearMyMarchBtn.addEventListener("click", () => {
    myMarchMinEl.value = 0;
    myMarchSecEl.value = 0;
    saveMyMarchTime();
  });

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
    if (isSyncing) return;
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
          activeEl.id !== "myMarchMin" &&
          activeEl.id !== "myMarchSec";

        cities = data.cities;
        lastSyncedUpdatedAt = data.updatedAt;
        if (!isTypingCard) {
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

  function getMyMarchSeconds() {
    const m = Math.max(0, parseInt(myMarchMinEl.value, 10) || 0);
    const s = Math.max(0, parseInt(myMarchSecEl.value, 10) || 0);
    return m * 60 + s;
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

  function renderCities() {
    cityListEl.innerHTML = "";

    // 見るだけモードは「カウントがスタートしている集結のみ」表示
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
        // 【見るだけページ用】最小限のシンプル表示
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
            <div class="launch-alert view-mode-launch" data-role="launch-box">
              <span>自分の発射まで</span>
              <span data-role="launch-rem">--:--.-</span>
            </div>
          </div>
        `;
      } else {
        // 【編集ページ用】フル操作表示
        card.innerHTML = `
          <div class="card-top">
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
            <div class="launch-alert" data-role="launch-box" style="display: none;">
              <span>あなたの発射まで</span>
              <span data-role="launch-rem">--:--.-</span>
            </div>
          </div>

          <div class="card-actions">
            <button class="btn ${city.isRunning ? "btn-warning" : "btn-success"} start-btn">
              ${city.isRunning ? "❚❚ 一時停止" : "▶ スタート"}
            </button>
            <button class="btn btn-secondary reset-btn">↺ リセット</button>
          </div>
        `;

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

  function updateDisplay() {
    const now = Date.now();
    const myMarchSec = getMyMarchSeconds();

    const targetCities = isViewMode
      ? cities.filter((c) => c.isRunning)
      : cities;

    targetCities.forEach((city) => {
      const card = cityListEl.querySelector(`.city-card[data-id="${city.id}"]`);
      if (!card) return;

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

      const statusEl = card.querySelector('[data-role="status"]');
      const arrivalEl = card.querySelector('[data-role="arrival"]');
      const waitRemEl = card.querySelector('[data-role="wait-rem"]');
      const launchBoxEl = card.querySelector('[data-role="launch-box"]');
      const launchRemEl = card.querySelector('[data-role="launch-rem"]');

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

      // 自分の発射までのカウントダウン表示
      if (isViewMode && myMarchSec <= 0) {
        launchBoxEl.style.display = "flex";
        launchBoxEl.classList.remove("launch-now");
        launchRemEl.textContent = "上で自分の行軍時間を入力";
      } else if (myMarchSec > 0) {
        launchBoxEl.style.display = "flex";
        const launchDiff = arrivalRemainingSec - myMarchSec;
        if (arrivalRemainingSec <= 0) {
          launchBoxEl.classList.remove("launch-now");
          launchRemEl.textContent = "着弾済み";
        } else if (launchDiff > 0) {
          launchBoxEl.classList.remove("launch-now");
          launchRemEl.textContent = `あと ${formatTime(launchDiff, true)}`;
        } else if (launchDiff > -3) {
          launchBoxEl.classList.add("launch-now");
          launchRemEl.textContent = "🔥 今すぐ発射！";
        } else {
          launchBoxEl.classList.remove("launch-now");
          launchRemEl.textContent = `タイミング経過 (${Math.abs(launchDiff).toFixed(1)}秒遅れ)`;
        }
      } else {
        launchBoxEl.style.display = "none";
      }
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // URLコピー用ヘルパー
  function buildShareUrl(mode) {
    const shareUrl = new URL(window.location.origin + window.location.pathname);
    shareUrl.searchParams.set("room", roomId);
    if (mode === "view") {
      shareUrl.searchParams.set("mode", "view");
    }
    return shareUrl.toString();
  }

  // イベント登録（編集モード用）
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

  // 初期化実行
  loadMyMarchTime();
  pullStateFromServer(true);
  setInterval(updateDisplay, 100);
  setInterval(() => pullStateFromServer(false), 1000);
})();
