// ===== MAX30102 側定数 =====
const MAX_SERVICE_UUID = "3a5197ff-07ce-499e-8d37-d3d457af549a";
const MAX_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef0";
const MAX_RAW_CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef1";
const MAX_DEVICE_NAME = "MAX R";

// ===== MLX90632 側定数 =====
const MLX_SERVICE_UUID = "4a5197ff-07ce-499e-8d37-d3d457af549a";
const MLX_CHARACTERISTIC_UUID = "fedcba98-7654-3210-fedc-ba9876543210";
const MLX_DEVICE_NAME = "MLX R";

// 共通ユーティリティ
function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function formatLocalTimeWithMs(epochMs) {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
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

// チャート作成
function makeLineChart(canvasId, yTitle, aLabel, bLabel) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [
      { label: aLabel, data: [], borderWidth: 2, borderColor: "rgb(75, 192, 192)", fill:false, pointRadius:0, tension:0.2 },
      { label: bLabel, data: [], borderWidth: 2, borderColor: "rgb(255, 99, 132)", fill:false, pointRadius:0, tension:0.2 }
    ]},
    options: {
      responsive: true,
      animation: { duration: 0 },
      scales: { x: { title: { display: true, text: "経過時間 (s)" } },
                y: { beginAtZero: false, title: { display: true, text: yTitle } } }
    }
  });
}

// ====== MAX 名前空間 ======
const MAX = {
  device:null, service:null, characteristic:null, rawCharacteristic:null,
  measureStartEpochMs:null, 
  receivedData:[], rawReceivedData:[], chart:null, bpmBuffer:[], RATE_SIZE:4,
  connected:false,
  // ★追加: チャート更新用のスロットル設定
  lastChartUpdateMs: 0, 
  CHART_UPDATE_INTERVAL_MS: 50, // 50ms (20FPS) に制限
  els:{
    connect: document.getElementById("max-connect"),
    disconnect: document.getElementById("max-disconnect"),
    status: document.getElementById("max-status"),
    deviceName: document.getElementById("max-deviceName"),
    bpm: document.getElementById("max-bpmValue"),
    avg: document.getElementById("max-avgBpmValue"),
    time: document.getElementById("max-timeValue"),
    recv: document.getElementById("max-recvTimeValue"),
    distance: document.getElementById("max-distanceStatus"),
  },

  ensureChart(){ if(!this.chart) this.chart = makeLineChart("max-realtimeChart","BPM","BPM","平均BPM"); },
  resetView(){
    this.receivedData.length = 0; this.rawReceivedData.length = 0; this.bpmBuffer = [];
    if(this.chart){ this.chart.data.labels=[]; this.chart.data.datasets[0].data=[]; this.chart.data.datasets[1].data=[]; this.chart.update(); }
    this.els.bpm.textContent="-"; this.els.avg.textContent="-"; this.els.time.textContent="-"; this.els.recv.textContent="-"; this.els.distance.textContent="-";
    this.measureStartEpochMs = null;
    this.lastChartUpdateMs = 0; // ★リセット
  },

  handleNotification: (event)=>{
    const v = event.target.value; if(v.byteLength!==8) return;
    const recvEpochMs = Date.now();
    const bpm = v.getFloat32(0,true);
    const sensorElapsedMs = v.getUint32(4,true);
    const sensorElapsedS = sensorElapsedMs/1000;

    MAX.bpmBuffer.push(bpm); if(MAX.bpmBuffer.length>MAX.RATE_SIZE) MAX.bpmBuffer.shift();
    const beatAvg = MAX.bpmBuffer.reduce((a,b)=>a+b,0)/MAX.bpmBuffer.length;

    const measureElapsedS = MAX.measureStartEpochMs ? (recvEpochMs - MAX.measureStartEpochMs)/1000 : 0;
    
    // UI表示は毎回更新
    MAX.els.bpm.textContent = bpm.toFixed(2);
    MAX.els.avg.textContent = beatAvg.toFixed(2);
    MAX.els.time.textContent = measureElapsedS.toFixed(2);
    MAX.els.recv.textContent = formatLocalTimeWithMs(recvEpochMs);

    // ★改善2: グラフ更新をスロットルする
    const now = Date.now();
    if(now - MAX.lastChartUpdateMs >= MAX.CHART_UPDATE_INTERVAL_MS) {
        MAX.ensureChart();
        const maxPts=50;
        // グラフ用データ配列の更新も、更新時のみに限定
        MAX.chart.data.labels.push(measureElapsedS.toFixed(1));
        MAX.chart.data.datasets[0].data.push(bpm);
        MAX.chart.data.datasets[1].data.push(beatAvg);
        if(MAX.chart.data.labels.length>maxPts){ MAX.chart.data.labels.shift(); MAX.chart.data.datasets[0].data.shift(); MAX.chart.data.datasets[1].data.shift(); }
        MAX.chart.update("none");
        MAX.lastChartUpdateMs = now;
    }

    // データロギングは毎回実行
    MAX.receivedData.push({ bpm, beatAvg, sensor_elapsed_ms:sensorElapsedMs, sensor_elapsed_s:sensorElapsedS,
      measure_elapsed_s:measureElapsedS, recv_epoch_ms:recvEpochMs, recv_jst: formatLocalTimeForCSV(recvEpochMs) });
  },

   handleRawNotification:(event)=>{
    const v = event.target.value; 
    if(v.byteLength !== 12) return;
    const irValue = v.getUint32(0, true);
    const redValue = v.getUint32(4, true);
    const sensorElapsedMs = v.getUint32(8, true);

    // 距離判定ロジック (irValue < 50000 なら離れている)
    if(irValue < 50000){
      MAX.els.distance.textContent="センサとの距離が離れています"; 
      MAX.els.distance.style.color="#d00"; MAX.els.distance.style.fontWeight="600"; 
    } else { 
      MAX.els.distance.textContent="距離は正常です"; 
      MAX.els.distance.style.color="#046307"; MAX.els.distance.style.fontWeight="600"; 
    }

    // ローデータ格納 
    const recvEpochMs = Date.now();
    MAX.rawReceivedData.push({ 
        irValue, redValue, 
        sensor_elapsed_ms: sensorElapsedMs,
        recv_epoch_ms: recvEpochMs, 
        recv_jst: formatLocalTimeForCSV(recvEpochMs) 
    });
  }
};

// ====== MLX 名前空間 ======
const MLX = {
  device:null, service:null, characteristic:null,
  measureStartEpochMs:null, receivedData:[], chart:null, intervalId:null, 
  // ★削除: latestSampleは不要になるため削除
  // latestSample:null,
  connected:false,
  els:{
    connect: document.getElementById("mlx-connect"),
    disconnect: document.getElementById("mlx-disconnect"),
    status: document.getElementById("mlx-status"),
    deviceName: document.getElementById("mlx-deviceName"),
    amb: document.getElementById("mlx-ambValue"),
    obj: document.getElementById("mlx-objValue"),
    time: document.getElementById("mlx-timeValue"),
    recv: document.getElementById("mlx-recvTimeValue"),
  },

  ensureChart(){
    if(!this.chart){
      const ctx = document.getElementById("mlx-realtimeChart").getContext("2d");
      this.chart = new Chart(ctx, {
        type:"line",
        data:{ labels:[], datasets:[
          {label:"Ambient (°C)", data:[], borderColor:"rgb(75, 192, 192)", fill:false, pointRadius:0, tension:0.2},
          {label:"Object (°C)", data:[], borderColor:"rgb(255, 99, 132)", fill:false, pointRadius:0, tension:0.2}
        ]},
        options:{ responsive:true, animation:{duration:0},
          scales:{ x:{title:{display:true,text:"経過時間 (s)"}}, y:{beginAtZero:false,title:{display:true,text:"温度 (°C)"}} } }
      });
    }
  },

  resetView(){
    this.receivedData.length = 0;
    if(this.chart){ this.chart.data.labels=[]; this.chart.data.datasets[0].data=[]; this.chart.data.datasets[1].data=[]; this.chart.update(); }
    this.els.amb.textContent="-"; this.els.obj.textContent="-"; this.els.time.textContent="-"; this.els.recv.textContent="-";
    this.measureStartEpochMs = null; 
    // ★削除: latestSampleは不要になるため削除
    // this.latestSample=null;
    // ★削除: intervalIdは不要になるため削除
    // this.intervalId=null;
  },

  // ★改善1: リアルタイム処理に移行（processLatestSampleのロジックを統合）
  handleNotification:(event)=>{
    const v=event.target.value; if(v.byteLength!==16) return;
    const recvEpochMs=Date.now();
    const amb=v.getFloat32(0,true); const obj=v.getFloat32(4,true);
    const rawAmbient = v.getInt16(8, true); 
    const rawObject = v.getInt16(10, true);
    const sensorElapsedMs=v.getUint32(12,true);
    
    // 初回測定時間のセット
    if(!MLX.measureStartEpochMs) MLX.measureStartEpochMs = recvEpochMs;
    
    // processLatestSample のロジックを移植
    const sensorElapsedS = sensorElapsedMs/1000;
    const measureElapsedS = (recvEpochMs - MLX.measureStartEpochMs)/1000;

    // 画面表示
    MLX.els.amb.textContent = amb.toFixed(4);
    MLX.els.obj.textContent = obj.toFixed(4);
    MLX.els.time.textContent = measureElapsedS.toFixed(2);
    MLX.els.recv.textContent = formatLocalTimeWithMs(recvEpochMs);

    // グラフ更新
    MLX.ensureChart();
    const maxPts=50;
    MLX.chart.data.labels.push(measureElapsedS.toFixed(1));
    MLX.chart.data.datasets[0].data.push(amb);
    MLX.chart.data.datasets[1].data.push(obj);
    if(MLX.chart.data.labels.length>maxPts){ MLX.chart.data.labels.shift(); MLX.chart.data.datasets[0].data.shift(); MLX.chart.data.datasets[1].data.shift(); }
    MLX.chart.update("none");

    // データロギング
    MLX.receivedData.push({ amb, obj, rawAmbient, rawObject, sensor_elapsed_ms:sensorElapsedMs, sensor_elapsed_s:sensorElapsedS,
      measure_elapsed_s:measureElapsedS, recv_epoch_ms:recvEpochMs, recv_jst: formatLocalTimeForCSV(recvEpochMs) });
  },

  // ★削除: processLatestSample は不要
  // processLatestSample(){ ... } 
};

// ====== 統一ボタンと状態管理 ======
const measureAllBtn = document.getElementById("measure-all");
const downloadAllBtn = document.getElementById("download-all");
let measuring = false;

function updateUnifiedButtons() {
  measureAllBtn.disabled = !(MAX.connected &&  MLX.connected);
  downloadAllBtn.disabled = (MAX.receivedData.length===0 && MAX.rawReceivedData.length===0 && MLX.receivedData.length===0);
  measureAllBtn.textContent = measuring ? "計測停止" : "計測開始";
}

// ... (MAXの接続/切断ロジックは変更なし) ...
MAX.els.connect.addEventListener("click", async ()=>{
  try{
    MAX.els.status.textContent="接続中...";
    MAX.device = await navigator.bluetooth.requestDevice({ filters:[{name:MAX_DEVICE_NAME}], optionalServices:[MAX_SERVICE_UUID] });
    const server = await MAX.device.gatt.connect();
    MAX.service = await server.getPrimaryService(MAX_SERVICE_UUID);
    MAX.characteristic = await MAX.service.getCharacteristic(MAX_CHARACTERISTIC_UUID);
    MAX.rawCharacteristic = await MAX.service.getCharacteristic(MAX_RAW_CHARACTERISTIC_UUID);

    MAX.connected = true;
    MAX.els.status.textContent="接続済み"; MAX.els.deviceName.textContent=MAX.device.name;
    MAX.els.connect.disabled=true; MAX.els.disconnect.disabled=false;

    MAX.device.addEventListener("gattserverdisconnected", ()=>{
      try{ MAX.characteristic?.removeEventListener("characteristicvaluechanged", MAX.handleNotification);}catch{}
      try{ MAX.rawCharacteristic?.removeEventListener("characteristicvaluechanged", MAX.handleRawNotification);}catch{}
      MAX.connected=false; MAX.els.status.textContent="未接続"; MAX.els.deviceName.textContent="-";
      MAX.els.connect.disabled=false; MAX.els.disconnect.disabled=true;
      if(measuring) stopMeasurementAll(); // 片方が切れたら停止
      MAX.resetView();
      updateUnifiedButtons();
    });

    updateUnifiedButtons();
  }catch(e){
    console.error("MAX 接続エラー:", e);
    alert("MAXへの接続に失敗しました．");
    MAX.connected=false; MAX.els.status.textContent="未接続"; MAX.els.deviceName.textContent="-";
    MAX.els.connect.disabled=false; MAX.els.disconnect.disabled=true;
    updateUnifiedButtons();
  }
});

MAX.els.disconnect.addEventListener("click", async ()=>{
  try{
    MAX.els.status.textContent="未接続";
    if(MAX.device?.gatt.connected){
      if(measuring){ await MAX.characteristic.stopNotifications().catch(()=>{}); await MAX.rawCharacteristic.stopNotifications().catch(()=>{}); }
      MAX.device.gatt.disconnect();
    }
  }catch{}
});

// ... (MLXの接続/切断ロジックは変更なし) ...
MLX.els.connect.addEventListener("click", async ()=>{
  try{
    MLX.els.status.textContent="接続中...";
    MLX.device = await navigator.bluetooth.requestDevice({ filters:[{name:MLX_DEVICE_NAME}], optionalServices:[MLX_SERVICE_UUID] });
    const server = await MLX.device.gatt.connect();
    MLX.service = await server.getPrimaryService(MLX_SERVICE_UUID);
    MLX.characteristic = await MLX.service.getCharacteristic(MLX_CHARACTERISTIC_UUID);

    MLX.connected = true;
    MLX.els.status.textContent="接続済み"; MLX.els.deviceName.textContent=MLX.device.name;
    MLX.els.connect.disabled=true; MLX.els.disconnect.disabled=false;

    MLX.device.addEventListener("gattserverdisconnected", ()=>{
      try{ MLX.characteristic?.removeEventListener("characteristicvaluechanged", MLX.handleNotification);}catch{}
      // ★削除: intervalId関連の処理は不要
      // if(MLX.intervalId){ clearInterval(MLX.intervalId); MLX.intervalId=null; }
      MLX.connected=false; MLX.els.status.textContent="未接続"; MLX.els.deviceName.textContent="-";
      MLX.els.connect.disabled=false; MLX.els.disconnect.disabled=true;
      if(measuring) stopMeasurementAll();
      MLX.resetView();
      updateUnifiedButtons();
    });

    updateUnifiedButtons();
  }catch(e){
    console.error("MLX 接続エラー:", e);
    alert("MLXへの接続に失敗しました．");
    MLX.connected=false; MLX.els.status.textContent="未接続"; MLX.els.deviceName.textContent="-";
    MLX.els.connect.disabled=false; MLX.els.disconnect.disabled=true;
    updateUnifiedButtons();
  }
});

MLX.els.disconnect.addEventListener("click", async ()=>{
  try{
    MLX.els.status.textContent="未接続";
    if(MLX.device?.gatt.connected){
      if(measuring){ 
        await MLX.characteristic.stopNotifications().catch(()=>{});
       }
      
      MLX.device.gatt.disconnect();
    }
  }catch{}
});

// ---- 計測の開始／停止（統一） ----
async function startMeasurementAll(){
  // MAX開始
  try{
    MAX.resetView(); MAX.characteristic.removeEventListener("characteristicvaluechanged", MAX.handleNotification); }catch{}
  try{ MAX.rawCharacteristic.removeEventListener("characteristicvaluechanged", MAX.handleRawNotification);}catch{}
  MAX.characteristic.addEventListener("characteristicvaluechanged", MAX.handleNotification);
  MAX.rawCharacteristic.addEventListener("characteristicvaluechanged", MAX.handleRawNotification);
  await MAX.characteristic.startNotifications();
  await MAX.rawCharacteristic.startNotifications();
  MAX.measureStartEpochMs = Date.now();
  MAX.lastChartUpdateMs = 0; // ★初期化

  // MLX開始
  try{ MLX.resetView(); MLX.characteristic.removeEventListener("characteristicvaluechanged", MLX.handleNotification);}catch{}
  MLX.characteristic.addEventListener("characteristicvaluechanged", MLX.handleNotification);
  await MLX.characteristic.startNotifications();
  // ★削除: setIntervalによるポーリングは不要
  // MLX.measureStartEpochMs = Date.now();
  // MLX.intervalId = setInterval(MLX.processLatestSample, 1000);

  measuring = true;
  updateUnifiedButtons();
  console.log("統一計測開始");
}

async function stopMeasurementAll(){
  // MAX停止
  try{ await MAX.characteristic.stopNotifications(); }catch{}
  try{ await MAX.rawCharacteristic.stopNotifications(); }catch{}
  try{ MAX.characteristic.removeEventListener("characteristicvaluechanged", MAX.handleNotification);}catch{}
  try{ MAX.rawCharacteristic.removeEventListener("characteristicvaluechanged", MAX.handleRawNotification);}catch{}
  MAX.measureStartEpochMs = null;

  // MLX停止
  try{ await MLX.characteristic.stopNotifications(); }catch{}
  try{ MLX.characteristic.removeEventListener("characteristicvaluechanged", MLX.handleNotification);}catch{}
  // ★削除: clearIntervalは不要
  // if(MLX.intervalId){ clearInterval(MLX.intervalId); MLX.intervalId=null; }
  MLX.measureStartEpochMs = null;

  measuring = false;
  updateUnifiedButtons();
  console.log("統一計測停止");
}

measureAllBtn.addEventListener("click", async ()=>{
  if(!(MAX.connected && MLX.connected)) return;
  if(measuring) await stopMeasurementAll();
  else{
    try{ await startMeasurementAll(); }
    catch(e){
      console.error("統一計測開始エラー:", e);
      await stopMeasurementAll(); // ロールバック
      alert("計測開始に失敗しました．両デバイスの接続状態を確認してください．");
    }
  }
});

// ---- 一括ダウンロード（Excelブック） ----
downloadAllBtn.addEventListener("click", ()=>{
  if(MAX.receivedData.length===0 && MAX.rawReceivedData.length===0 && MLX.receivedData.length===0){
    alert("ダウンロードするデータがありません．");
    return;
  }
  const wb = XLSX.utils.book_new();
  // MAXシート
  if(MAX.receivedData.length>0){
    const maxRows = MAX.receivedData.map(r=>({
      BPM: r.bpm,
      Avg_BPM: r.beatAvg,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      SensorElapsed_s: r.sensor_elapsed_s,
      MeasureElapsed_s: r.measure_elapsed_s,
      RecvEpoch_ms: r.recv_epoch_ms,
      RecvJST: r.recv_jst
    }));
    const wsMax = XLSX.utils.json_to_sheet(maxRows);
    XLSX.utils.book_append_sheet(wb, wsMax, "MAX30102");
  }else{
    const wsMax = XLSX.utils.aoa_to_sheet([["データなし"]]);
    XLSX.utils.book_append_sheet(wb, wsMax, "MAX30102");
  }
  // Rawデータ (MAX30102_RAW シートとして追加)
  if(MAX.rawReceivedData.length>0){
    const rawRows = MAX.rawReceivedData.map(r=>({
      IR_Value: r.irValue,
      RED_Value: r.redValue,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      RecvEpoch_ms: r.recv_epoch_ms,
      RecvJST: r.recv_jst
    }));
    const wsRaw = XLSX.utils.json_to_sheet(rawRows);
    XLSX.utils.book_append_sheet(wb, wsRaw, "MAX30102_RAW"); 
  }else{
    const wsRaw = XLSX.utils.aoa_to_sheet([["データなし"]]);
    XLSX.utils.book_append_sheet(wb, wsRaw, "MAX30102_RAW"); 
  }
  // MLXシート (Rawデータ統合済み)
  if(MLX.receivedData.length>0){
    const mlxRows = MLX.receivedData.map(r=>({
      Ambient_C: r.amb,
      Object_C: r.obj,
      Raw_Ambient: r.rawAmbient, 
      Raw_Object: r.rawObject,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      SensorElapsed_s: r.sensor_elapsed_s,
      MeasureElapsed_s: r.measure_elapsed_s,
      RecvEpoch_ms: r.recv_epoch_ms,
      Recvjst: r.recv_jst
    }));
    const wsMlx = XLSX.utils.json_to_sheet(mlxRows);
    XLSX.utils.book_append_sheet(wb, wsMlx, "MLX90632");
  }else{
    const wsMlx = XLSX.utils.aoa_to_sheet([["データなし"]]);
    XLSX.utils.book_append_sheet(wb, wsMlx, "MLX90632");
  }
  
  const filename = "MAX_MLX_measurement.xlsx";
  XLSX.writeFile(wb, filename);
});

// 初期化
updateUnifiedButtons();
