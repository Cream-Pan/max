// BLEサービスとキャラクタリスティックのUUIDはArduinoスケッチと一致させる 

 const SERVICE_UUID = "3a5197ff-07ce-499e-8d37-d3d457af549a"; 

 const CHARACTERISTIC_UUID = "abcdef01-1234-5678-1234-56789abcdef0"; 

 const DEVICE_NAME = "MAX30102 Sensor"; 



 let device; 

 let receivedData = []; // ここは正しいです 



 document.getElementById('connectButton').addEventListener('click', async () => { 

     try { 

         console.log('スキャン中...'); 

         device = await navigator.bluetooth.requestDevice({ 

             filters: [{ name: DEVICE_NAME }], 

             optionalServices: [SERVICE_UUID] 

         }); 



         console.log(`デバイス '${device.name}' に接続中...`); 

         const server = await device.gatt.connect(); 

         const service = await server.getPrimaryService(SERVICE_UUID); 

         const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID); 



         await characteristic.startNotifications(); 

         console.log('通知を購読中...'); 



         characteristic.addEventListener('characteristicvaluechanged', (event) => { 

             const value = event.target.value; 

              

             if (value.byteLength === 12) { 

                 const bpm = value.getFloat32(0, true); 

                 const beatAvg = value.getInt32(4, true); 

                 const currentTime = value.getUint32(8, true); 



                 // ⭐ ここにデータを配列に保存する処理を追加します 

                 receivedData.push({ 

                     bpm: bpm, 

                     beatAvg: beatAvg, 

                     currentTime: currentTime 

                 }); 



                 document.getElementById('bpmValue').textContent = bpm.toFixed(2); 

                 document.getElementById('avgBpmValue').textContent = beatAvg; 

                 document.getElementById('timeValue').textContent = (currentTime / 1000).toFixed(2); 

             } 

         }); 



     } catch (error) { 

         console.error("エラーが発生しました: ", error); 

         alert("接続に失敗しました。コンソールを確認してください。"); 

     } 

 }); 



 document.getElementById('downloadButton').addEventListener('click', () => { 

     if (receivedData.length === 0) { 

         alert("ダウンロードするデータがありません。"); 

         return; 

     } 



     let csvContent = "BPM,Avg_BPM,Time\n"; 

     receivedData.forEach(item => { 

         csvContent += `${item.bpm},${item.beatAvg},${item.currentTime}\n`; 

     }); 



     const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); 

     const url = URL.createObjectURL(blob); 

     const link = document.createElement("a"); 



     link.href = url; 

     link.download = "sensor_data.csv"; 

     document.body.appendChild(link); 

     link.click();  // または link.dispatchEvent(new MouseEvent("click")); 

     document.body.removeChild(link); 


 });
