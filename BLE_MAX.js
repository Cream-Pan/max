// 設定
const SERVICE_UUID = "3a5197ff-07ce-499e-8d37-d3d457af549a";
const CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef0";
const FLAG_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef1";
const DEVICE_NAME = "MAX R";

// 状態
let device, characteristic, flagCharacteristic, service;
let measureStartEpochMs = null;   // 計測(通知購読開始)時刻
const receivedData = [];          // CSV用
let chart;

// ブラウザ側で平均計算する窓長（拍数）
const RATE_SIZE = 4;
let bpmBuffer = [];

// UI要素の取得
const connectButton = document.getElementById("connectButton");
const disconnectButton = document.getElementById("disconnectButton");
const measureButton = document.getElementById("measureButton");
const downloadButton = document.getElementById("downloadButton");
const statusSpan = document.getElementById("status");
const deviceNameSpan = document.getElementById("deviceName");

function formatLocalTimeWithMs(epochMs) {
  const d = new Date(epochMs);
  const pad = (n, w=2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}

function formatLocalTimeForCSV(epochMs) {
  const d = new Date(epochMs);
  const pad = (n, w=2) => String(n).padStart(w, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const milliseconds = pad(d.getMilliseconds(), 3);
  // ISO 8601形式のローカルタイム文字列を生成
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function updateChart(bpm, beatAvg, elapsedS) {
  const maxDataPoints = 50;
  
  if (!chart) {
    const ctx = document.getElementById("realtimeChart").getContext("2d");
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [{
          label: "BPM",
          data: [],
          borderWidth: 2,
          borderColor: "rgb(75, 192, 192)",
          fill: false,
          pointRadius: 0, 
          tension: 0.2
        },{
          label: "平均BPM",
          data: [],
          borderWidth: 2,
          borderColor: "rgb(255, 99, 132)",
          fill: false,
          pointRadius: 0, 
          tension: 0.2
        }]
      },
      options: {
        responsive: true,
        animation: {
          duration: 0 // アニメーションを無効化
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "経過時間 (s)"
            }
          },
          y: {
            beginAtZero: false,
            title: {
              display: true,
              text: "BPM"
            }
          }
        }
      }
    });
  }

  // データを追加
  chart.data.labels.push(elapsedS.toFixed(1));
  chart.data.datasets[0].data.push(bpm);
  chart.data.datasets[1].data.push(beatAvg);
  
  // データ数が上限を超えたら古いものを削除
  if (chart.data.labels.length > maxDataPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }
  chart.update("none");
}

function handleNotification(event) {
  const value = event.target.value;
  if (value.byteLength !== 8) return;

  // 受信時刻（クライアント）
  const recvEpochMs = Date.now();

  // ペイロード：BPM(float32), Avg(int32), Elapsed_ms(uint32) (LE)
  const bpm = value.getFloat32(0, true);
  //const beatAvg = value.getInt32(4, true);
  const sensorElapsedMs = value.getUint32(4, true);
  const sensorElapsedS = sensorElapsedMs / 1000;

   // 平均（ブラウザ側）
  bpmBuffer.push(bpm);
  if (bpmBuffer.length > RATE_SIZE) bpmBuffer.shift();
  const beatAvg = bpmBuffer.reduce((a, b) => a + b, 0) / bpmBuffer.length;

  // 計測開始からの経過時間（クライアント側）
  const measureElapsedS = measureStartEpochMs
    ? (recvEpochMs - measureStartEpochMs) / 1000
    : 0;

  // 表示
  document.getElementById("bpmValue").textContent = bpm.toFixed(2);
  document.getElementById("avgBpmValue").textContent = beatAvg;
  document.getElementById("timeValue").textContent = measureElapsedS.toFixed(2);
  document.getElementById("recvTimeValue").textContent = formatLocalTimeWithMs(recvEpochMs);

  // グラフを更新
  updateChart(bpm, beatAvg, measureElapsedS);

  // 記録（CSV）
  receivedData.push({
    bpm,
    beatAvg,
    sensor_elapsed_ms: sensorElapsedMs,
    sensor_elapsed_s: sensorElapsedS,
    measure_elapsed_s: measureElapsedS,
    recv_epoch_ms: recvEpochMs,
    recv_jst: formatLocalTimeForCSV(recvEpochMs)
  });

  if (receivedData.length === 1) {
    downloadButton.disabled = false;
  }
}

function handleFlagNotification(event) {
  const value = event.target.value;
  if (value.byteLength !== 1) return;

  const flag = value.getUint8(0);
  const distanceStatusEl = document.getElementById("distanceStatus");

  if (flag === 0) {
    distanceStatusEl.textContent = "センサとの距離が離れています";
    distanceStatusEl.style.color = "#d00";
    distanceStatusEl.style.fontWeight = "600";
  } else {
    distanceStatusEl.textContent = "距離は正常です";
    distanceStatusEl.style.color = "#046307";
    distanceStatusEl.style.fontWeight = "600";
  }
}

function clearDataAndChart() {
    receivedData.length = 0; // データをクリア
    bpmBuffer = [];
    if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.data.datasets[1].data = [];
        chart.update();
    }
    document.getElementById("bpmValue").textContent = "-";
    document.getElementById("avgBpmValue").textContent = "-";
    document.getElementById("timeValue").textContent = "-";
    document.getElementById("recvTimeValue").textContent = "-";
    measureStartEpochMs = null;
    measureButton.textContent = "計測開始";

    downloadButton.disabled = true;
}

connectButton.addEventListener("click", async () => {
  try {
    statusSpan.textContent = "接続中...";
    device = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }],
      optionalServices: [SERVICE_UUID]
    });
    const server = await device.gatt.connect();
    service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    flagCharacteristic = await service.getCharacteristic(FLAG_CHARACTERISTIC_UUID);

    statusSpan.textContent = "接続済み";
    deviceNameSpan.textContent = device.name;
    connectButton.disabled = true;
    disconnectButton.disabled = false;
    measureButton.disabled = false;
    measureButton.textContent = "計測開始";
    downloadButton.disabled = true; 

    device.addEventListener("gattserverdisconnected", () => {
      try { characteristic?.removeEventListener("characteristicvaluechanged", handleNotification); } catch(_) {}
      statusSpan.textContent = "未接続";
      deviceNameSpan.textContent = "-";
      connectButton.disabled = false;
      disconnectButton.disabled = true;
      measureButton.disabled = true;
      clearDataAndChart();
    });
  } catch (e) {
    console.error("エラー:", e);
    alert("接続に失敗しました．コンソールを確認してください．");
    statusSpan.textContent = "未接続";
    deviceNameSpan.textContent = "-";
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    measureButton.disabled = true;
  }
});

disconnectButton.addEventListener("click", async() => {
  if (device && device.gatt.connected) {
    if (measureStartEpochMs) {
      // 計測中の場合は停止
      try { await characteristic.stopNotifications(); } catch(_) {}
      try { await flagcharacteristic.stopNotifications(); } catch(_) {}
    }
    device.gatt.disconnect();
  }
});

measureButton.addEventListener("click", async () => {
  if (!characteristic) {
    alert("まずBLEデバイスに接続してください。");
    return;
  }

  if (measureStartEpochMs) {
    // 計測停止
    try { await characteristic.stopNotifications(); } catch(_) {}
    try { characteristic.removeEventListener("characteristicvaluechanged", handleNotification); } catch(_) {}
    try { flagCharacteristic.removeEventListener("characteristicvaluechanged", handleFlagNotification);} catch(_) {}
    measureStartEpochMs = null;
    connectButton.disabled = false;
    measureButton.textContent = "計測開始";
    console.log("計測停止");
  } else {
    // 計測開始
    bpmBuffer = [];
    receivedData.length = 0; 
    if (chart) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.data.datasets[1].data = [];
      chart.update();
    }
    try { characteristic.removeEventListener("characteristicvaluechanged", handleNotification); } catch(_) {}
    try { flagCharacteristic.removeEventListener("characteristicvaluechanged", handleFlagNotification);} catch(_) {}
    characteristic.addEventListener("characteristicvaluechanged", handleNotification);
    flagCharacteristic.addEventListener("characteristicvaluechanged", handleFlagNotification);
    await characteristic.startNotifications();
    await flagCharacteristic.startNotifications();
    measureStartEpochMs = Date.now();

    connectButton.disabled = true;
    downloadButton.disabled = true;
    measureButton.textContent = "計測停止";
    console.log("計測開始");
  }
});


downloadButton.addEventListener("click", () => {
  if (receivedData.length === 0) {
    alert("ダウンロードするデータがありません．");
    return;
  }
  let csv = "BPM,Avg_BPM,SensorElapsed_ms,SensorElapsed_s,MeasureElapsed_s,RecvEpoch_ms,RecvJST\n";
  for (const r of receivedData) {
    csv += `${r.bpm},${r.beatAvg},${r.sensor_elapsed_ms},${r.sensor_elapsed_s},${r.measure_elapsed_s},${r.recv_epoch_ms},${r.recv_jst}\n`;
  }
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "MAX30102_data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
