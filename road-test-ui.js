(()=>{
'use strict';
// v6.14.46 ROAD TEST UI. Loaded as a separate <script> AFTER app-v6.14.44.js in the road-test
// build only (see road-test/build-artifact.mjs) — the normal index.html / manual-check builds
// never load this file, so ordinary use is completely unaffected. Talks to app.js's telemetry
// recorder (jarvisRoadTestStart/Stop/ClearSession/Export, jarvisRoadTestEnabled/Buffer/Markers)
// as bare identifiers, the same pattern bootstrap.js already uses for `destination=...` — classic
// <script> tags in one document share one global lexical environment, and this file is wrapped in
// its own IIFE so nothing it declares (including `$`) can collide with app.js's own top-level
// bindings the way the earlier `const $` incident in navigation-simulator-core.js did.
//
// Activation is explicit only: a `?roadtest=1` URL param (the road-test build's bootstrap adds
// this itself) or `localStorage.jarvisRoadTestMode==='1'`. Neither the normal app nor the
// manual-check simulator ever sets either, so this panel and the telemetry it drives are inert
// for every other build.
const params=new URLSearchParams(location.search);
const activated=params.get('roadtest')==='1'||localStorage.getItem('jarvisRoadTestMode')==='1';
if(!activated)return;

const KIND_LABEL={
  OFF_ROUTE_BEGIN:'逸脱開始',REROUTING_BEGIN:'再検索開始',REROUTING_END:'再検索終了',
  REROUTE_ACCEPTED:'新ルート確定',REJOIN_BEGIN:'復帰開始',REJOIN_END:'復帰完了',
  ARRIVED:'到着',VEHICLE_POSE_LARGE_STEP:'表示位置ジャンプ',
  ROUTE_PROJECTION_BACKWARD_JUMP:'進捗後退',ROUTE_PROJECTION_FORWARD_JUMP:'進捗異常前進',
  MANEUVER_CLASS_CHANGE:'分岐種別変化',GUIDANCE_EXPECTED_BUT_MISSING:'案内欠落',
  GUIDANCE_TURN_BUT_STRAIGHT_GEOMETRY:'案内矛盾',APP_RESUME:'アプリ復帰',
  WAKE_LOCK_ON:'画面保持ON',WAKE_LOCK_RELEASED:'画面保持解除'
};
function hhmmss(t){return new Date(t).toLocaleTimeString('ja-JP',{hour12:false});}
function markerShorthand(m){return m?`${KIND_LABEL[m.kind]||m.kind} (${hhmmss(m.t)})`:'-';}

function eventCount(){return jarvisRoadTestBuffer?jarvisRoadTestBuffer.count:0;}
function lastMarker(){return jarvisRoadTestMarkers.length?jarvisRoadTestMarkers[jarvisRoadTestMarkers.length-1]:null;}

async function exportJson(){
  const payload=jarvisRoadTestExport();
  const json=JSON.stringify(payload,null,2);
  const filename=`jarvis-road-test-${payload.session.id}.json`;
  const box=$('rtExportBox');
  // Primary path: the artifact platform's `downloads` capability (a genuine one-tap save, with a
  // viewer confirmation) — only present when this page is running as a published Claude Artifact
  // with that capability declared. Falls through cleanly (no error surfaced) everywhere else.
  try{
    const downloads=await window.claude?.use?.('downloads');
    if(downloads){
      await downloads.save({filename,data:json});
      setStatus(`エクスポート済み：${filename}`,'ok');
      return;
    }
  }catch(e){/* declined/unavailable — fall through to the manual paths below */}
  // Secondary path: a plain <a download> Blob link. Inert inside the Artifact viewer's sandbox,
  // but works normally when this file is opened directly (the standalone build, AirDrop/Files/
  // a plain web server) — exactly the same asymmetry documented for the manual-check build.
  try{
    const blob=new Blob([json],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=filename;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }catch(e){}
  // Guaranteed-working fallback: show the JSON inline so it can be selected/copied by hand even
  // when neither of the above actually saved a file.
  if(box){
    box.hidden=false;box.value=json;
    setStatus('JSONをテキスト表示しました（自動保存できない環境のため）。全選択してコピーしてください。','warn');
  }
}

function setStatus(msg,cls){const el=$('rtStatus');if(el){el.textContent=msg;el.className='rt-status'+(cls?' '+cls:'');}}

function render(){
  const chip=$('rtChip');if(!chip)return;
  const state=(typeof jarvisNavTrackingState!=='undefined')?jarvisNavTrackingState:'-';
  $('rtChipText').textContent=`RT ${jarvisRoadTestEnabled?'●REC':'○停止'} ${eventCount()}件 ${state}`;
  if($('rtRecState'))$('rtRecState').textContent=jarvisRoadTestEnabled?'記録中':'停止中';
  if($('rtEventCount'))$('rtEventCount').textContent=String(eventCount());
  if($('rtNavState'))$('rtNavState').textContent=state;
  if($('rtLastMarker'))$('rtLastMarker').textContent=markerShorthand(lastMarker());
  if($('rtErrorCount'))$('rtErrorCount').textContent=String(jarvisRoadTestErrors.length);
}

function $(id){return document.getElementById(id);}

function mount(){
  const style=document.createElement('style');
  style.textContent=`
#rtChip{position:fixed;top:8px;left:8px;z-index:100000;background:rgba(255,176,32,.94);color:#1a1204;font:700 11px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 10px;border-radius:999px;box-shadow:0 4px 14px #0006;cursor:pointer;white-space:nowrap}
#rtPanel{position:fixed;top:40px;left:8px;right:8px;z-index:100000;max-width:420px;background:rgba(10,14,20,.97);color:#eef4ff;border:1px solid #50617a;border-radius:14px;padding:12px;font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 12px 40px #0009;display:none;max-height:74vh;overflow:auto}
#rtPanel.open{display:block}
#rtPanel h3{margin:0 0 8px;font-size:13px;color:#ffb020}
#rtPanel .rt-row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid #1e2836}
#rtPanel .rt-row span:first-child{color:#9db0c9}
#rtPanel .rt-buttons{display:flex;gap:8px;margin-top:10px}
#rtPanel button{flex:1;border:1px solid #5a6a82;background:#1c2635;color:#fff;border-radius:9px;padding:9px;font:700 12px/1 inherit;-webkit-appearance:none}
#rtPanel button.danger{background:#3a1c22;border-color:#7a3a44}
.rt-status{margin-top:8px;font-size:11px;color:#9db0c9}
.rt-status.ok{color:#8df0aa}
.rt-status.warn{color:#ffd76a}
#rtExportBox{width:100%;height:160px;margin-top:8px;background:#0c1119;color:#bcd0e6;border:1px solid #33415a;border-radius:8px;padding:8px;font:10.5px/1.4 ui-monospace,Menlo,monospace;white-space:pre}
`;
  document.head.appendChild(style);

  const chip=document.createElement('div');chip.id='rtChip';chip.innerHTML='<span id="rtChipText">RT 起動中…</span>';
  document.body.appendChild(chip);

  const panel=document.createElement('div');panel.id='rtPanel';
  panel.innerHTML=`
<h3>${JARVIS_ROAD_TEST_BUILD_ID} ロードテスト</h3>
<div class="rt-row"><span>記録状態</span><span id="rtRecState">-</span></div>
<div class="rt-row"><span>保持イベント数</span><span id="rtEventCount">0</span></div>
<div class="rt-row"><span>現在のナビ状態</span><span id="rtNavState">-</span></div>
<div class="rt-row"><span>直近の高信号イベント</span><span id="rtLastMarker">-</span></div>
<div class="rt-row"><span>エラー件数</span><span id="rtErrorCount">0</span></div>
<div class="rt-buttons">
  <button id="rtToggle" type="button">記録ON/OFF</button>
  <button id="rtExport" type="button">JSON書き出し</button>
  <button id="rtClear" type="button" class="danger">新規セッション</button>
</div>
<div id="rtStatus" class="rt-status">記録は既定でONです。安全な場所に停車してから操作してください。</div>
<textarea id="rtExportBox" readonly hidden></textarea>
`;
  document.body.appendChild(panel);

  chip.onclick=()=>panel.classList.toggle('open');
  $('rtToggle').onclick=()=>{
    if(jarvisRoadTestEnabled){jarvisRoadTestStop();setStatus('記録を停止しました。','warn');}
    else{jarvisRoadTestStart();setStatus('記録を再開しました（新しいセッション）。','ok');}
    render();
  };
  $('rtExport').onclick=()=>exportJson();
  $('rtClear').onclick=()=>{
    jarvisRoadTestClearSession();
    $('rtExportBox').hidden=true;$('rtExportBox').value='';
    setStatus('新しいロードテストセッションを開始しました。','ok');
    render();
  };

  jarvisRoadTestStart();
  setStatus('記録中です。走行中の操作は避け、安全な場所で確認してください。','ok');
  render();
  setInterval(render,1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
