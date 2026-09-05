
'use strict';

let watchId=null,running=false,startTime=null,elapsedBefore=0,lastPos=null,totalDistanceM=0,maxSpeedKmh=0,currentSpeedKmh=0,timerId=null,starting=false;
let wakeLock=null;
let jarvisLocationTrackingActive=false;
let lastAcceptedSpeed=0;
let resumeGuardUntil=0;
let goodSamplesAfterResume=0;

// NAV
let currentLat=null,currentLon=null,currentHeading=null;
let headingSource='--';
let courseLastFix=null;
let courseLastAt=0;
let destination=null;
let searchAbort=null;

const $=id=>document.getElementById(id);
const MAX_REASONABLE_SPEED=220;
const MAX_ACCEL_KMH_PER_SEC=65;
const RESUME_GUARD_MS=4500;
const MAX_ACCEPTABLE_ACCURACY=45;

function elapsedMs(){return elapsedBefore+(running&&startTime?Date.now()-startTime:0)}
function fmtTime(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`}
function haversine(a,b){const R=6371000,p1=a.latitude*Math.PI/180,p2=b.latitude*Math.PI/180,dp=(b.latitude-a.latitude)*Math.PI/180,dl=(b.longitude-a.longitude)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))}
function bearing(lat1,lon1,lat2,lon2){
  const p1=lat1*Math.PI/180,p2=lat2*Math.PI/180,dl=(lon2-lon1)*Math.PI/180;
  const y=Math.sin(dl)*Math.cos(p2);
  const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}
function normalize180(deg){return ((deg+540)%360)-180}
function smoothHeading(prev,next,alpha=0.38){
  if(typeof next!=='number'||!isFinite(next)) return prev;
  if(typeof prev!=='number'||!isFinite(prev)) return (next+360)%360;
  return (prev + normalize180(next-prev)*alpha + 360)%360;
}
function setTextIf(id,text){const el=$(id);if(el)el.textContent=text}
function syncLandscapeStatus(){setTextIf('landStatus',$('status')?.textContent||'待機中')}


// ===== v2.4 Google Maps cockpit =====
let navGoogleMap=null, landGoogleMap=null;
let navSquidOverlay=null, landSquidOverlay=null;
let navDestMarker=null, landDestMarker=null;
let navGuideLine=null, landGuideLine=null;
let nearbyPlaces=[];
let navNearbyMarkers=[], landNearbyMarkers=[];
let navNearbyInfo=null, landNearbyInfo=null;
// v3.5 dual navigation modes
let navMode=localStorage.getItem('jarvisNavMode')||'ADVENTURE';
let routeData=null, routeCandidates=[], selectedRouteIndex=0, navRouteLine=null, landRouteLine=null, navAltRouteLines=[];
let navRouteLabels=[];
let routePreviewActive=false;
let navSessionStarted=false;
let routeRequestSeq=0, routeLastOrigin=null, routeLastAt=0;
// v6.9 auto reroute trial
let autoRerouteOffRouteSince=0;
let autoRerouteOffRouteFixes=0;
let autoRerouteLastAt=0;
let autoRerouteBusy=false;
const AUTO_REROUTE_DISTANCE_M=20;     // v6.14: fallback lateral threshold when not accuracy-adaptive (see jarvisAutoRerouteUpdate)
const VISUAL_ESCAPE_MIN_M=11;          // v6.14.7: squid follows the vehicle before reroute is decided
const VISUAL_ESCAPE_HEADING_DEG=44;    // v6.14.14: visual handoff follows real course before stale-route pull becomes visible
const AUTO_REROUTE_HOLD_MS=1200;       // steady-evidence path: avoid one-fix GPS spikes
const AUTO_REROUTE_MIN_FIXES=3;        // steady-evidence path: require consistent evidence
const AUTO_REROUTE_COOLDOWN_MS=2000;   // v6.14.54: reroute promptly on a real deviation, still bounded to avoid API storms
const AUTO_REROUTE_RETRY_MS=6500;      // transient API failure retry while still off-route
const AUTO_REROUTE_MAX_ACCURACY_M=40;  // weak GPS enters UNCERTAIN instead of forcing reroute
const AUTO_REROUTE_SETTLE_MS=6500;     // v6.14.54: grace window after a route commit before off-route evidence can accumulate again
const ORIGINAL_ROUTE_REJOIN_FIXES=3;   // v6.14.54: consecutive aligned fixes required to restore the original route
let jarvisNavTrackingState='TRACKING'; // TRACKING / UNCERTAIN / OFF_ROUTE / REROUTING / ARRIVED
let jarvisDeviationEscape=false;       // true: reroute state says old route is stale
let jarvisVisualGpsPriority=false;       // display-only: GPS owns squid temporarily; MUST NOT trigger reroute state
let jarvisVisualOnRouteFixes=0;
let jarvisDeviationEvidence=0;
let jarvisDeviationStartedAt=0;
let jarvisDeviationGpsIsolationUntil=0; // v6.14.18: first 5s after confirmed departure, GPS owns the vehicle display exclusively
// v6.14.12: after a new reroute arrives, keep GPS/free-track as visual authority until
// the physical vehicle is confidently aligned with the NEW route for several fixes.
let jarvisPendingRouteRejoin=false;
let jarvisPendingRouteRejoinFixes=0;
let jarvisPendingRouteRejoinStartedAt=0;
let jarvisAutoDeviationCount=0;       // 1回目=元ルート復帰、2回目以降=意思尊重
let jarvisOriginalRoutePath=[];       // START時に選んだ基準ルート
// v6.14.54: the full route object chosen at START (not just its points), frozen for the whole
// session so a later reroute can be compared against it. Used only to detect a genuine physical
// return to the route the rider began on — see jarvisMatchOriginalRoute/jarvisRestoreOriginalRoute.
let jarvisOriginalRouteSnapshot=null; // {route,pts,cum,total}
let jarvisOriginalRouteAnchorS=null;
let jarvisOriginalRouteRejoinFixes=0;
// v6.14.54: set only by jarvisCommitRoute for a REROUTE/ORIGINAL_ROUTE_REJOIN commit — the moment
// a route changes WHILE already navigating. Distinct from "routeLastAt is recent", which is also
// true for the very first route computed at START and is not evidence of a just-resolved deviation.
let jarvisRouteSettleUntil=0;
let jarvisLastMovingHeading=null;     // 現在の走行方向を再検索の意図に使う
let routeViaPoints=[];                // 地図長押しで作るユーザー指定経由点
let routeViaMarkers=[];
let jarvisLongPressTimer=null;
let jarvisLongPressLatLng=null;


// v5.7 voice guidance (Web Speech API)
let voiceGuideEnabled=true;
let voiceSelectedId=localStorage.getItem('jarvisVoiceId')||'';
let voiceRate=Math.min(1.3,Math.max(.7,Number(localStorage.getItem('jarvisVoiceRate')||.96)));
let voicePitch=Math.min(1.3,Math.max(.7,Number(localStorage.getItem('jarvisVoicePitch')||1)));
let voiceVolume=Math.min(1,Math.max(0,Number(localStorage.getItem('jarvisVoiceVolume')||1)));
let voiceStepIndex=0;
let voiceAnnounced=new Set();
let jarvisGuidanceCache=null;
let jarvisGuidanceCacheAt=0;
let jarvisGuidancePrevDistance=new Map();
let voiceArrivalSpoken=false;
let voiceLastSpokenAt=0;
// v6.14.44 VOICE TRUTH: a monotonically increasing id stamped on every navigation session start
// (jarvisStartNavigation). A speechSynthesis cooldown timer from a PREVIOUS session/scenario must
// never suppress the first announcement of a NEW one ("stale-start" guard) — the simulator runs
// six scenarios back-to-back in a single page session, so this matters in a way it never did on a
// single real drive. voiceLastSpokenAt is reset alongside it in jarvisResetVoiceProgress().
let jarvisVoiceSessionId=0;
let jarvisLastGuidanceKeyBase=null;
// Ground-truth log of every jarvisSpeak() attempt (accepted or not), independent of whatever the
// UI/voiceAnnounced bookkeeping believes happened. The simulator computes voiceCount/voiceLateCount/
// voiceDuplicateCount/voiceOrderErrors from this, filtered to the current session, instead of trusting
// state that a bug in the announcement logic could itself have corrupted.
window.__jarvisVoiceEvents=window.__jarvisVoiceEvents||[];
let jarvisMapsReady=false;
let navMapFollow=true;
let navMapUserMoved=false;
let headingUpMode=localStorage.getItem('jarvisHeadingUpMode')==='1';
let mapThemeMode=localStorage.getItem('jarvisMapThemeMode')||'AUTO';
let mapViewMode=localStorage.getItem('jarvisMapViewMode')||'ROADMAP';
if(!['ROADMAP','SATELLITE','HYBRID','3D'].includes(mapViewMode))mapViewMode='ROADMAP';
let navTrafficLayer=null, landTrafficLayer=null;
// v6.4 Google 3D Maps (portrait NAV trial)
let navMap3D=null, maps3dLibrary=null, nav3DRouteLine=null, nav3DCurrentMarker=null, nav3DDestMarker=null;
let nav3DInitPromise=null;
let autoIsDay=null;
let jarvisMapsLibrary=null;
let jarvisRenderingType=null;
let jarvisDiagLastTarget=null;
const JARVIS_MAP_DEFAULT={lat:34.6937,lng:135.5023};
const JARVIS_DARK_MAP_STYLE=[
  {elementType:'geometry',stylers:[{color:'#17212b'}]},
  {elementType:'labels.text.stroke',stylers:[{color:'#17212b'}]},
  {elementType:'labels.text.fill',stylers:[{color:'#aeb8c4'}]},
  {featureType:'road',elementType:'geometry',stylers:[{color:'#2b3948'}]},
  {featureType:'road',elementType:'geometry.stroke',stylers:[{color:'#1b2632'}]},
  {featureType:'road.highway',elementType:'geometry',stylers:[{color:'#3a4a5c'}]},
  {featureType:'water',elementType:'geometry',stylers:[{color:'#0b1924'}]},
  {featureType:'poi',elementType:'labels.text.fill',stylers:[{color:'#8d9baa'}]},
  {featureType:'transit',elementType:'labels.text.fill',stylers:[{color:'#8d9baa'}]}
];
function jarvisSquidSvg(){return `<div class="squid-arrow"><div class="earth-orb blue-orb" aria-hidden="true"><span class="earth-orb-shine"></span></div></div>`;}
function jarvisCreateSquidOverlay(map){
  const overlay=new google.maps.OverlayView();
  overlay.position=null;overlay.heading=0;overlay.div=null;
  overlay.onAdd=function(){
    const div=document.createElement('div');
    div.className='map-squid-marker';
    div.innerHTML=jarvisSquidSvg();
    this.div=div;
    this.getPanes().overlayMouseTarget.appendChild(div);
  };
  overlay.draw=function(){
    if(!this.div||!this.position)return;
    const pt=this.getProjection().fromLatLngToDivPixel(this.position);
    if(!pt)return;
    this.div.style.left=pt.x+'px';
    this.div.style.top=pt.y+'px';
    this.div.style.setProperty('--squid-heading',(this.heading||0)+'deg');
  };
  overlay.onRemove=function(){this.div?.remove();this.div=null;};
  overlay.setPosition=function(lat,lng,heading=0){
    if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lng)))return;
    this.position=new google.maps.LatLng(Number(lat),Number(lng));
    this.heading=Number(heading)||0;
    this.draw();
  };
  overlay.setMap(map);
  return overlay;
}
function jarvisEffectiveTheme(){
  if(mapThemeMode==='LIGHT'||mapThemeMode==='DARK') return mapThemeMode;
  if(autoIsDay!==null) return autoIsDay?'LIGHT':'DARK';
  const h=new Date().getHours(); return (h>=6&&h<18)?'LIGHT':'DARK';
}
function jarvisMapOptions(){
  const scheme=jarvisEffectiveTheme();
  return {center:JARVIS_MAP_DEFAULT,zoom:15,disableDefaultUI:true,gestureHandling:'greedy',keyboardShortcuts:false,clickableIcons:false,backgroundColor:scheme==='DARK'?'#0b111a':'#e8edf2',colorScheme:scheme,zoomControl:false,renderingType:jarvisRenderingType,headingInteractionEnabled:true,tiltInteractionEnabled:false,tilt:0,heading:0};
}
function jarvisRenderingLabel(map){
  const rt=map?.getRenderingType?.();
  if(!rt) return '判定中';
  const vector=jarvisMapsLibrary?.RenderingType?.VECTOR;
  return rt===vector?'VECTOR':'RASTER';
}
function jarvisHeadingDiag(map,target){
  if(!map)return;
  const actual=Number(map.getHeading?.()??0);
  const src=(typeof currentHeading==='number'&&isFinite(currentHeading))?headingSource:'--';
  const mode=jarvisRenderingLabel(map);
  const t=target===null||target===undefined?'--':Math.round(target)+'°';
  const a=Number.isFinite(actual)?Math.round(actual)+'°':'--';
  setTextIf('navMapDiag',`${mode} / ${src} / 指令 ${t} / 地図 ${a}`);
  if(mode==='RASTER'&&headingUpMode) setTextIf('navMapState','回転非対応（RASTER）');
}

function jarvisUpdateThemeButton(){
  const label=mapThemeMode==='AUTO'?'AUTO':mapThemeMode==='DARK'?'DARK':'LIGHT';
  setTextIf('themeModeBtn',label); setTextIf('landThemeModeBtn',label);
}
function jarvisRebuildMaps(){
  const navCenter=navGoogleMap?.getCenter?.(); const navZoom=navGoogleMap?.getZoom?.();
  navSquidOverlay?.setMap(null); landSquidOverlay?.setMap(null);
  navDestMarker?.setMap(null); landDestMarker?.setMap(null); navGuideLine?.setMap(null); landGuideLine?.setMap(null);
  navGoogleMap=landGoogleMap=null; navSquidOverlay=landSquidOverlay=null; navDestMarker=landDestMarker=null; navGuideLine=landGuideLine=null; jarvisMapsReady=false;
  jarvisInitMaps();
  if(navGoogleMap&&navCenter){navGoogleMap.setCenter(navCenter); if(navZoom)navGoogleMap.setZoom(navZoom)}
}
function jarvisToggleThemeMode(){
  mapThemeMode=mapThemeMode==='AUTO'?'DARK':mapThemeMode==='DARK'?'LIGHT':'AUTO';
  localStorage.setItem('jarvisMapThemeMode',mapThemeMode); jarvisUpdateThemeButton(); jarvisRebuildMaps();
}

function jarvisMapViewId(){
  return mapViewMode==='SATELLITE'?'satellite':mapViewMode==='HYBRID'?'hybrid':'roadmap';
}
function jarvisUpdateMapViewButton(){
  const label=mapViewMode==='SATELLITE'?'航空':mapViewMode==='HYBRID'?'複合':mapViewMode==='3D'?'3D':'地図';
  setTextIf('mapViewBtn',label); setTextIf('landMapViewBtn',label);
  $('mapViewBtn')?.classList.toggle('active',mapViewMode==='3D');
}
async function jarvisInit3DMap(){
  if(navMap3D)return navMap3D;
  if(nav3DInitPromise)return nav3DInitPromise;
  nav3DInitPromise=(async()=>{
    try{
      maps3dLibrary=maps3dLibrary||await google.maps.importLibrary('maps3d');
      const {Map3DElement}=maps3dLibrary;
      const host=$('navMap3D'); if(!host)throw new Error('3D表示領域なし');
      const center=(typeof currentLat==='number'&&typeof currentLon==='number')?{lat:currentLat,lng:currentLon,altitude:0}:destination?{lat:destination.lat,lng:destination.lon,altitude:0}:{...JARVIS_MAP_DEFAULT,altitude:0};
      navMap3D=new Map3DElement({center,range:navSessionStarted?1800:4500,tilt:navSessionStarted?55:48,heading:jarvisTravelHeading()||0,mode:'HYBRID',defaultUIHidden:false});
      navMap3D.addEventListener('gmp-error',(ev)=>{
        const detail=ev?.error?.message||ev?.detail?.message||ev?.message||'WebGL / 3D初期化失敗';
        setTextIf('navMapState','3D ERROR');
        setTextIf('navMapDiag','3D初期化失敗: '+detail);
      });
      navMap3D.addEventListener('gmp-steadychange',(ev)=>{
        if(ev?.isSteady===false)return;
        setTextIf('navMapState','VECTOR 3D');
        setTextIf('navMapDiag','3D描画OK / tilt '+Math.round(Number(navMap3D.tilt||0))+'° / range '+Math.round(Number(navMap3D.range||0))+'m');
      });
      host.replaceChildren(navMap3D);
      setTextIf('navMapState','VECTOR 3D');
      setTextIf('navMapDiag','Maps 3D(beta) 読み込み中…');
      setTimeout(()=>jarvisRender3DOverlays(),1200);
      return navMap3D;
    }catch(e){
      navMap3D=null; nav3DInitPromise=null;
      setTextIf('navMapState','3Dマップ初期化エラー');
      setTextIf('navMapDiag','3D ERROR '+(e?.message||e));
      throw e;
    }
  })();
  return nav3DInitPromise;
}
async function jarvisRender3DOverlays(){
  if(!navMap3D||!maps3dLibrary)return;
  try{
    if(nav3DRouteLine){nav3DRouteLine.remove();nav3DRouteLine=null}
    if(nav3DCurrentMarker){nav3DCurrentMarker.remove();nav3DCurrentMarker=null}
    if(nav3DDestMarker){nav3DDestMarker.remove();nav3DDestMarker=null}
    const {Polyline3DElement,Marker3DElement}=maps3dLibrary;
    if(routeData?.path?.length&&navMode==='ROUTE'){
      nav3DRouteLine=new Polyline3DElement({path:routeData.path.map(p=>({lat:Number(typeof p.lat==='function'?p.lat():p.lat),lng:Number(typeof p.lng==='function'?p.lng():p.lng),altitude:2})),altitudeMode:'RELATIVE_TO_GROUND',strokeColor:'#0b63ce',strokeWidth:9,outerColor:'#ffffff',outerWidth:2,drawsOccludedSegments:true,zIndex:20});
      navMap3D.append(nav3DRouteLine);
    }
    if(typeof currentLat==='number'&&typeof currentLon==='number'){
      nav3DCurrentMarker=new Marker3DElement({position:{lat:currentLat,lng:currentLon,altitude:5},label:'🦑',altitudeMode:'RELATIVE_TO_GROUND',drawsWhenOccluded:true,sizePreserved:true,zIndex:30});
      navMap3D.append(nav3DCurrentMarker);
    }
    if(destination){
      nav3DDestMarker=new Marker3DElement({position:{lat:destination.lat,lng:destination.lon,altitude:5},label:'目的地',altitudeMode:'RELATIVE_TO_GROUND',drawsWhenOccluded:true,sizePreserved:true,zIndex:25});
      navMap3D.append(nav3DDestMarker);
    }
  }catch(e){console.warn('3D overlay',e)}
}
async function jarvisSync3D(force=false){
  if(mapViewMode!=='3D')return;
  try{
    const map3d=await jarvisInit3DMap();
    if(typeof currentLat==='number'&&typeof currentLon==='number'&&(navMapFollow||force)){
      map3d.center={lat:currentLat,lng:currentLon,altitude:0};
      map3d.range=navSessionStarted?1800:4200;
      map3d.tilt=navSessionStarted?55:48;
      map3d.heading=headingUpMode?(jarvisTravelHeading()||0):0;
    }else if(destination&&force){
      map3d.center={lat:destination.lat,lng:destination.lon,altitude:0};
    }
    await jarvisRender3DOverlays();
    if($('navMapState')?.textContent!=='3D READY') setTextIf('navMapState','VECTOR 3D');
    if(!$('navMapDiag')?.textContent?.startsWith('3D描画OK')) setTextIf('navMapDiag','Maps 3D(beta) / '+(navSessionStarted?'安全追従':'俯瞰表示')+' / '+(headingUpMode?'進行↑':'北↑'));
  }catch(e){}
}
async function jarvisApplyMapView(){
  const shell=$('navMap')?.parentElement;
  // v6.8: 旧フォトリアル3D(Map3DElement)は完全に表示経路から外す
  shell?.classList.remove('is-3d');
  $('navMap3D')?.classList.add('hidden');
  const id=jarvisMapViewId();
  if(mapViewMode==='3D'){
    try{navGoogleMap?.setMapTypeId?.('roadmap')}catch(e){}
    try{landGoogleMap?.setMapTypeId?.('roadmap')}catch(e){}
    jarvisApplyVector3D();
  }else{
    try{navGoogleMap?.setTilt?.(0);navGoogleMap?.setHeading?.(headingUpMode?(jarvisTravelHeading()||0):0)}catch(e){}
    try{landGoogleMap?.setTilt?.(0);landGoogleMap?.setHeading?.(headingUpMode?(jarvisTravelHeading()||0):0)}catch(e){}
    try{navGoogleMap?.setMapTypeId?.(id)}catch(e){}
    try{landGoogleMap?.setMapTypeId?.(id)}catch(e){}
  }
  setTimeout(()=>{try{google.maps.event.trigger(navGoogleMap,'resize');jarvisSyncMaps(true)}catch(e){}},80);
  jarvisUpdateMapViewButton();
}
function jarvisToggleMapView(){
  mapViewMode=mapViewMode==='ROADMAP'?'SATELLITE':mapViewMode==='SATELLITE'?'HYBRID':mapViewMode==='HYBRID'?'3D':'ROADMAP';
  localStorage.setItem('jarvisMapViewMode',mapViewMode);
  jarvisApplyMapView();
}
function jarvisSyncTrafficLayers(){
  const want=navMode==='ROUTE'&&!navSessionStarted;
  try{
    const TL=jarvisMapsLibrary?.TrafficLayer||google.maps?.TrafficLayer;
    if(TL&&navGoogleMap){ if(!navTrafficLayer)navTrafficLayer=new TL(); navTrafficLayer.setMap(want?navGoogleMap:null); }
    if(TL&&landGoogleMap){ if(!landTrafficLayer)landTrafficLayer=new TL(); landTrafficLayer.setMap(want?landGoogleMap:null); }
  }catch(e){}
}


// ===== v6.12.1 continuous route-following display engine =====
// 生GPSは速度・距離・逸脱判定用としてそのまま保持。
// イカとナビカメラだけを選択ルート上へ投影し、requestAnimationFrameで連続移動させる。
let jarvisMotion={
  raf:null,
  path:null,
  pts:null,
  cum:null,
  total:0,
  targetS:null,
  displayS:null,
  lastFixAt:0,
  speedMps:0,
  displayHeading:null,
  lastFrameAt:0,
  lastCameraAt:0,
  lastProjection:null
};
// v6.14.24/27/28 diagnostics. `projectionS` is the single authoritative route-progress value
// (always equal to jarvisMotion.targetS after the progress-corridor clamp in jarvisMotionAcceptFix).
// `candidateS` is the raw pre-clamp pick from jarvisMotionProject's own corridor/fallback search and
// is diagnostic-only: it can legitimately sit far from projectionS right after a reroute/rejoin and
// must never be read as "the" vehicle progress. (A field literally named `selectedS` previously caused
// exactly that confusion in simulator reports and has been removed.)
let jarvisMotionDiag={
  projectionS:null,
  candidateS:null,
  projectionDistance:null,
  localCorridorUsed:null,
  localCorridorDistance:null,
  fallbackDistance:null,
  mismatch:null,
  departureCandidate:false,
  departureFixes:0,
  visualThreshold:null
};
let jarvisDepartureFixes=0;
// FREE DRIVE: smooth raw GPS when ROUTE START is not active.
let jarvisFreeMotion={raf:null,targetLat:null,targetLon:null,displayLat:null,displayLon:null,lastFixAt:0,speedMps:0,targetHeading:null,displayHeading:null,lastFrameAt:0,lastCameraAt:0,accuracy:99,acceptedLat:null,acceptedLon:null,acceptedAt:0,acceptedHeading:null,rawHistory:[],turnBlend:0,lastRawLat:null,lastRawLon:null,lastRawAt:0,renderSpeedMps:0};

// v6.14.7 SAFE FREE TRACK: improve no-route tracking without changing route-navigation ownership.
// The ROUTE motion engine remains exactly on the v6.14.1 control path.
function jarvisFreeCorridorTargetSafe(lat,lng){
  const f=jarvisFreeMotion;
  if(!Number.isFinite(f.displayLat)||!Number.isFinite(f.displayLon)||!Number.isFinite(f.targetHeading)||f.speedMps<1.2)return{lat,lng};
  const R=6371000,p=f.displayLat*Math.PI/180;
  const east=(lng-f.displayLon)*Math.PI/180*R*Math.cos(p);
  const north=(lat-f.displayLat)*Math.PI/180*R;
  const h=f.targetHeading*Math.PI/180,ue=Math.sin(h),un=Math.cos(h);
  const along=east*ue+north*un;
  const cross=east*un-north*ue;
  const acc=Number.isFinite(f.accuracy)?f.accuracy:99;
  let keep=acc<=12?.35:acc<=20?.45:acc<=35?.58:.78;
  // Never let the filter resist a real lane/road change.
  if(Math.abs(cross)>14)keep=Math.max(keep,.82);
  const e2=along*ue+(cross*keep)*un;
  const n2=along*un-(cross*keep)*ue;
  return{lat:f.displayLat+(n2/R)*180/Math.PI,lng:f.displayLon+(e2/(R*Math.cos(p)))*180/Math.PI};
}
function jarvisFreeAcceptFix(lat,lon,speedKmh,accuracyM){
  if(!Number.isFinite(Number(lat))||!Number.isFinite(Number(lon)))return;
  const f=jarvisFreeMotion,now=performance.now();
  const rawLat=+lat,rawLon=+lon;
  f.speedMps=Math.max(0,Math.min(45,(+speedKmh||0)/3.6));
  f.accuracy=Number.isFinite(Number(accuracyM))?Number(accuracyM):99;

  // v6.14.18: one GPS fix -> one estimator input. Keep a short raw history and infer
  // the rider's trajectory from several fixes instead of trusting a single 2-3 m hop.
  f.rawHistory.push({lat:rawLat,lng:rawLon,t:now,acc:f.accuracy});
  while(f.rawHistory.length>7 || (f.rawHistory.length>2 && now-f.rawHistory[0].t>4200))f.rawHistory.shift();

  let histHeading=null;
  if(f.rawHistory.length>=3){
    const newest=f.rawHistory[f.rawHistory.length-1];
    let anchor=null;
    for(let i=0;i<f.rawHistory.length-1;i++){
      const q=f.rawHistory[i];
      const d=haversine({latitude:q.lat,longitude:q.lng},{latitude:newest.lat,longitude:newest.lng});
      const age=(newest.t-q.t)/1000;
      if(age>=.7 && d>=Math.max(4.5,Math.min(9,(q.acc+newest.acc)*.18))){anchor=q;break;}
    }
    if(anchor)histHeading=bearing(anchor.lat,anchor.lng,newest.lat,newest.lng);
  }
  const globalHeading=jarvisTravelHeading();
  let hd=Number.isFinite(histHeading)?histHeading:globalHeading;

  // Estimate whether a genuine turn is developing. The blend ramps up over several fixes;
  // unlike v6.14.16 we never fully open the lateral filter on one noisy heading sample.
  let turnDelta=0;
  if(Number.isFinite(hd)&&Number.isFinite(f.acceptedHeading))turnDelta=Math.abs(jarvisNorm180(hd-f.acceptedHeading));
  const turnWanted=(f.speedMps>1.3 && turnDelta>16)?Math.min(1,(turnDelta-12)/42):0;
  f.turnBlend += (turnWanted-f.turnBlend)*(turnWanted>f.turnBlend?.34:.18);
  f.turnBlend=Math.max(0,Math.min(1,f.turnBlend));

  let accepted={lat:rawLat,lng:rawLon};
  if(Number.isFinite(f.acceptedLat)&&Number.isFinite(f.acceptedLon)){
    const dt=Math.max(.18,Math.min(3,(now-(f.acceptedAt||now))/1000));
    const prev={latitude:f.acceptedLat,longitude:f.acceptedLon};
    const raw={latitude:rawLat,longitude:rawLon};
    const rawDist=haversine(prev,raw);
    const acc=Math.max(4,Math.min(55,f.accuracy));

    // Hard anti-hop gate: allow physically plausible progress plus a modest accuracy budget.
    // Excess displacement is consumed over multiple fixes instead of in one frame.
    const plausible=Math.max(4.5,f.speedMps*dt*(1.35+.35*f.turnBlend)+Math.min(8.5,acc*.24));
    const stepDist=Math.min(rawDist,plausible);
    const rawBearing=rawDist>.5?bearing(f.acceptedLat,f.acceptedLon,rawLat,rawLon):hd;
    if(rawDist>plausible&&Number.isFinite(rawBearing))
      accepted=jarvisFreeForward(f.acceptedLat,f.acceptedLon,rawBearing,stepDist);

    if(f.speedMps>1.1&&Number.isFinite(hd)){
      const R=6371000,p=f.acceptedLat*Math.PI/180;
      const east=(accepted.lng-f.acceptedLon)*Math.PI/180*R*Math.cos(p);
      const north=(accepted.lat-f.acceptedLat)*Math.PI/180*R;
      const h=hd*Math.PI/180,ue=Math.sin(h),un=Math.cos(h);
      const along=east*ue+north*un,cross=east*un-north*ue;

      // Straight: strongly suppress sideways jitter. During a real turn, relax only gradually.
      const baseKeep=f.accuracy<=12?.24:f.accuracy<=22?.34:f.accuracy<=35?.48:.62;
      let lateralKeep=baseKeep+(0.76-baseKeep)*f.turnBlend;
      if(Math.abs(cross)>18)lateralKeep=Math.min(.82,lateralKeep+.10);
      const e2=along*ue+(cross*lateralKeep)*un;
      const n2=along*un-(cross*lateralKeep)*ue;
      accepted={lat:f.acceptedLat+(n2/R)*180/Math.PI,lng:f.acceptedLon+(e2/(R*Math.cos(p)))*180/Math.PI};
    }
  }

  f.acceptedLat=accepted.lat;f.acceptedLon=accepted.lng;f.acceptedAt=now;
  if(Number.isFinite(hd)){
    const hGain=.10+.12*f.turnBlend;
    f.acceptedHeading=Number.isFinite(f.acceptedHeading)?smoothHeading(f.acceptedHeading,hd,hGain):hd;
    f.targetHeading=Number.isFinite(f.targetHeading)?smoothHeading(f.targetHeading,hd,.12+.14*f.turnBlend):hd;
  }
  f.targetLat=accepted.lat;f.targetLon=accepted.lng;f.lastFixAt=now;
  f.lastRawLat=rawLat;f.lastRawLon=rawLon;f.lastRawAt=now;
  if(!Number.isFinite(f.displayLat)){f.displayLat=accepted.lat;f.displayLon=accepted.lng;f.displayHeading=Number.isFinite(hd)?hd:0;}
  jarvisFreeMotionStart();
}
function jarvisFreeForward(lat,lon,hd,m){const R=6371000,b=hd*Math.PI/180,d=m/R,p=lat*Math.PI/180,l=lon*Math.PI/180,p2=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b)),l2=l+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(p2));return{lat:p2*180/Math.PI,lng:l2*180/Math.PI};}

// ===== v6.14.45 VehiclePose ownership layer =====
//
// This formalizes an ownership boundary that already existed implicitly since v6.14.19's
// "display-engine separation" (jarvisFreeMotion owns the vehicle marker/camera; jarvisMotion
// owns route progress/guidance and must never write the marker) but had no explicit shape or
// name — every consumer either reached into jarvisFreeMotion's fields directly or read
// currentLat/currentLon ad hoc. VehiclePose is that shape, made explicit:
//
//   GPS measurement -> jarvisFreeMotion (independent estimator) -> VehiclePose -> vehicle ball + camera
//                                                                -> route projection (jarvisMotion) -> progress/maneuver/reroute/arrival/guidance
//
// jarvisFreeMotion remains the actual estimator/smoother (reused, not replaced — see
// jarvisFreeAcceptFix/jarvisFreeMotionStart above); VehiclePose is the canonical, named READ
// interface onto its current output, and the only thing route projection is allowed to consume.
// Route projection (jarvisMotionProject/jarvisMotionAcceptFix, below) must only ever READ a
// VehiclePose; it must never write jarvisFreeMotion's fields. That invariant is exercised
// directly by test/vehiclepose-ownership-tests.mjs (calls route-projection entry points in
// isolation and asserts jarvisFreeMotion's display fields are bit-identical before/after).
function jarvisBuildVehiclePose(lat,lng,heading,speedMps,timestampMs,extra){
  return {
    lat:Number(lat),lng:Number(lng),
    heading:Number.isFinite(heading)?Number(heading):null,
    speedMps:Number.isFinite(speedMps)?Math.max(0,Number(speedMps)):0,
    timestampMs:Number.isFinite(timestampMs)?Number(timestampMs):null,
    source:extra?.source||'GPS_FREE_MOTION',
    confidence:Number.isFinite(extra?.confidence)?extra.confidence:null,
    continuity:extra?.continuity||null
  };
}
// Diagnostics: visible to tests/simulator so the road-matcher fallback state (§ below) isn't a
// silent guess. `roadMatchAttempted`/`roadMatchFound` are always false/false today — there is no
// road-network candidate source yet (see jarvisRoadNetworkMatch) — but the fields exist now so a
// future matcher's activation is observable without another round of diagnostics churn.
let jarvisVehiclePoseDiag={source:null,confidence:null,ageMs:null,roadMatchAttempted:false,roadMatchFound:false,fallbackReason:null};
function jarvisGetVehiclePose(){
  const f=jarvisFreeMotion;
  if(!Number.isFinite(f.displayLat)||!Number.isFinite(f.displayLon))return null;
  const now=performance.now();
  const ageMs=f.lastFixAt?Math.max(0,now-f.lastFixAt):null;
  // Confidence is a simple, explicit function of reported GPS accuracy and fix recency — not a
  // new estimator, just a named readout of information jarvisFreeMotion already tracks, so a
  // future road-matcher (or a test) has something coarse-grained to reason about without
  // reaching into jarvisFreeMotion's internal fields itself.
  const accTerm=Number.isFinite(f.accuracy)?Math.max(0,1-Math.min(1,f.accuracy/50)):.5;
  const ageTerm=Number.isFinite(ageMs)?Math.max(0,1-Math.min(1,ageMs/4000)):.5;
  const confidence=Math.max(0,Math.min(1,accTerm*.6+ageTerm*.4));
  const gpsPose=jarvisBuildVehiclePose(f.displayLat,f.displayLon,f.displayHeading,f.speedMps,f.lastFixAt||null,{
    source:'GPS_FREE_MOTION',confidence,
    continuity:{ageMs,rawHistoryLen:Array.isArray(f.rawHistory)?f.rawHistory.length:0,turnBlend:f.turnBlend}
  });
  // Road-network snapping seam (§ "Road-network snapping readiness" below): try it, but this
  // sandbox/production build has no real road-network candidate source, so it always falls
  // through to the GPS/free-motion pose today. Kept as a real call (not inlined away) so wiring
  // in a genuine matcher later only means implementing jarvisRoadNetworkMatch's body.
  const snapped=jarvisRoadNetworkMatch(gpsPose);
  const finalPose=snapped||gpsPose;
  jarvisVehiclePoseDiag={
    source:finalPose.source,confidence:finalPose.confidence,ageMs,
    roadMatchAttempted:true,roadMatchFound:!!snapped,
    fallbackReason:snapped?null:'no road-network candidate source available (Maps JS exposes no navigable road graph); using GPS/free-motion VehiclePose'
  };
  return finalPose;
}

// ===== v6.14.45 road-network matcher seam (architecture only — see NEXT_BATCH_v6.14.45.md §3) =====
//
// Google Maps JavaScript API gives polylines for a COMPUTED ROUTE, not a general road-network
// graph with connectivity/lane/carriageway data the way a Navigation SDK does. There is
// therefore no real candidate geometry to snap arbitrary GPS positions onto today, and this
// batch does not invent any. What it adds is the scoring interface/data model a future matcher
// would need, and an explicit, observable fallback when — as always, currently — no candidates
// exist, instead of silently behaving as if snapping were unavailable.
//
// A road candidate, if a future matcher ever produces one, is expected to look like:
//   { id, distanceM, segmentHeading, continuityOk, speedPlausible, parallelAmbiguous, ambiguityKind }
// jarvisScoreRoadCandidate documents (and computes, for whenever real candidates exist) the
// weighted score a matcher would rank candidates by; it is intentionally unreachable in
// production today because jarvisRoadNetworkMatch never has a candidate list to score.
function jarvisScoreRoadCandidate(candidate,pose,prevMatch){
  if(!candidate||!pose)return Infinity;
  let score=Math.max(0,Number(candidate.distanceM)||0);
  if(Number.isFinite(pose.heading)&&Number.isFinite(candidate.segmentHeading)){
    const mismatch=jarvisHeadingMismatch(pose.heading,candidate.segmentHeading);
    score+=mismatch>115?260:mismatch>85?110:mismatch>55?35:0;
  }
  if(prevMatch&&candidate.continuityOk===false)score+=180;
  if(pose.speedMps>1&&candidate.speedPlausible===false)score+=140;
  if(candidate.parallelAmbiguous)score+=90;
  if(candidate.ambiguityKind==='RAMP'||candidate.ambiguityKind==='CARRIAGEWAY')score+=60;
  return score;
}
function jarvisRoadNetworkMatch(pose){
  // No road-network candidate source exists in this build (see comment above) — always report
  // "no candidates" rather than fabricating geometry. A future implementation would gather
  // nearby candidate segments here, score each with jarvisScoreRoadCandidate, and return the
  // best one (or null, using the same "explicitly no match" contract) when none clear a
  // minimum-confidence bar.
  return null;
}

function jarvisCameraLeadMeters(zoom){
  // v6.13.5: 44m looked too centered, 62m looked a little too low.
  // 54m is the calibrated midpoint target for the lower-middle cockpit position.
  const z=Number.isFinite(Number(zoom))?Number(zoom):18;
  return Math.max(8,Math.min(41,41*Math.pow(2,18-z)));
}
function jarvisCameraCenterAhead(lat,lng,heading,zoom){
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(heading))return{lat,lng};
  return jarvisFreeForward(lat,lng,heading,jarvisCameraLeadMeters(zoom));
}

let jarvisFollowCamera={lat:null,lng:null,heading:null,lastAt:0,lastMoveAt:0,zoom:18};
let jarvisRerouteCamera={mode:'NORMAL',startedAt:0,rejoinAt:0};
function jarvisSetRerouteCameraMode(mode){
  jarvisRerouteCamera.mode=mode||'NORMAL';
  if(mode==='DEVIATING')jarvisRerouteCamera.startedAt=Date.now();
  if(mode==='REJOINING')jarvisRerouteCamera.rejoinAt=Date.now();
}
function jarvisRerouteCameraZoom(baseZoom){
  const base=Number.isFinite(Number(baseZoom))?Number(baseZoom):18;
  if(jarvisRerouteCamera.mode==='DEVIATING'){
    const t=Math.max(0,Date.now()-(jarvisRerouteCamera.startedAt||Date.now()));
    // v6.14.14: do not jump to the wide view. Ease out over ~1.8 s so a missed turn
    // feels like the camera is calmly making room for the new course.
    const u=Math.min(1,t/1800),e=u*u*(3-2*u);
    const wide=17.05;
    return Math.min(base,base+(wide-base)*e);
  }
  if(jarvisRerouteCamera.mode==='REJOINING'){
    const t=Math.max(0,Date.now()-(jarvisRerouteCamera.rejoinAt||Date.now()));
    const u=Math.min(1,t/3000),e=u*u*(3-2*u);
    if(u>=1){jarvisRerouteCamera.mode='NORMAL';return base;}
    return 17.2+(base-17.2)*e;
  }
  return base;
}
function jarvisResetFollowCamera(){
  jarvisFollowCamera.lat=null;jarvisFollowCamera.lng=null;jarvisFollowCamera.heading=null;
  jarvisFollowCamera.lastAt=0;jarvisFollowCamera.lastMoveAt=0;
}
function jarvisFollowCameraUpdate(lat,lng,heading,zoom,now,fast=false){
  if(!navGoogleMap||!Number.isFinite(lat)||!Number.isFinite(lng))return;
  const c=jarvisFollowCamera;
  if(!Number.isFinite(c.lat)||!Number.isFinite(c.lng)){
    c.lat=lat;c.lng=lng;c.heading=Number.isFinite(heading)?heading:0;c.lastAt=now;c.zoom=zoom;
  }
  const dt=Math.max(.001,Math.min(.12,(now-(c.lastAt||now))/1000));c.lastAt=now;
  const rerouteMode=jarvisRerouteCamera.mode;
  let posTau=fast?.20:.34, headingTau=fast?.25:.42, zoomTau=fast?.18:.42;
  if(rerouteMode==='NORMAL'){
    // v6.14.13: heading-up should look composed, not servo-like. Google Navigation's
    // driving course follows direction of movement; we deliberately low-pass the CAMERA
    // heading so small GPS/polyline angle noise does not rotate the whole map.
    const sp=Math.max(0,Number(currentSpeedKmh)||0);
    headingTau=sp>=40?1.15:sp>=20?.92:.72;
    if(Number.isFinite(heading)&&Number.isFinite(c.heading)){
      const delta=Math.abs(jarvisNorm180(heading-c.heading));
      if(delta<4) heading=c.heading;                 // straight-line dead zone
      else if(delta>45) headingTau=Math.max(.62,headingTau*.78); // real turn: catch up, still smoothly
    }
  }
  if(rerouteMode==='DEVIATING'){
    // v6.14.14: off-route camera is deliberately unhurried. Position, vertical lead and
    // bearing all settle independently so the map never looks like it teleports to rescue
    // a vehicle that temporarily leaves the viewport.
    posTau=1.15; headingTau=1.70; zoomTau=.95;
  }else if(rerouteMode==='REJOINING'){
    // Once the new route is confirmed, restore the normal cockpit view gradually.
    posTau=.78; headingTau=1.18; zoomTau=1.05;
  }
  const a=1-Math.exp(-dt/posTau);
  let nextLat=c.lat+(lat-c.lat)*a,nextLng=c.lng+(lng-c.lng)*a;
  if(rerouteMode==='DEVIATING'){
    // Hard movement cap: even a large raw-GPS/projection gap is absorbed over time.
    const moveM=haversine({latitude:c.lat,longitude:c.lng},{latitude:nextLat,longitude:nextLng});
    const capM=Math.max(1.2,(Math.max(6,Number(currentSpeedKmh)||0)/3.6+4)*dt);
    if(moveM>capM&&moveM>0){
      const r=capM/moveM;nextLat=c.lat+(nextLat-c.lat)*r;nextLng=c.lng+(nextLng-c.lng)*r;
    }
  }
  c.lat=nextLat;c.lng=nextLng;
  if(Number.isFinite(heading))c.heading=smoothHeading(c.heading,heading,1-Math.exp(-dt/headingTau));
  const desiredZoom=jarvisRerouteCameraZoom(Number.isFinite(Number(zoom))?Number(zoom):18);
  if(!Number.isFinite(c.zoom))c.zoom=desiredZoom;
  const zoomA=1-Math.exp(-dt/zoomTau);
  c.zoom+=(desiredZoom-c.zoom)*zoomA;
  if(now-c.lastMoveAt<70)return;c.lastMoveAt=now;
  try{
    if(navGoogleMap.moveCamera)navGoogleMap.moveCamera({center:{lat:c.lat,lng:c.lng},zoom:c.zoom,heading:headingUpMode?(c.heading||0):0,tilt:mapViewMode==='3D'?55:0});
    else{navGoogleMap.setCenter({lat:c.lat,lng:c.lng});navGoogleMap.setZoom(c.zoom);navGoogleMap.setHeading?.(headingUpMode?(c.heading||0):0);}
  }catch(e){}
}

function jarvisFreeMotionStart(){
 if(jarvisFreeMotion.raf)return;jarvisFreeMotion.lastFrameAt=performance.now();
 const tick=now=>{jarvisFreeMotion.raf=requestAnimationFrame(tick);
  // v6.14.19: one display-location engine for TRACKING / OFF_ROUTE / REROUTING.
  // Route projection no longer owns the vehicle marker; this engine does.
  if(!navGoogleMap||!navMapFollow||!Number.isFinite(jarvisFreeMotion.targetLat))return;
  const dt=Math.max(.001,Math.min(.08,(now-jarvisFreeMotion.lastFrameAt)/1000));jarvisFreeMotion.lastFrameAt=now;
  let d=(!navSessionStarted?jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):{lat:jarvisFreeMotion.targetLat,lng:jarvisFreeMotion.targetLon}),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);
  const escape=!!(jarvisDeviationEscape||jarvisVisualGpsPriority);
  // v6.13.11: while off-route, real GPS is the authority. Prediction only bridges a short gap.
  const acc=Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:99;
  const isolated=Date.now()<jarvisDeviationGpsIsolationUntil;
  const predictAge=isolated?.25:(escape?.65:1.35), predictCap=isolated?3:(escape?10:25);
  if(jarvisFreeMotion.speedMps>1&&Number.isFinite(jarvisFreeMotion.targetHeading)&&age<predictAge)
    d=jarvisFreeForward(d.lat,d.lng,jarvisFreeMotion.targetHeading,Math.min(predictCap,jarvisFreeMotion.speedMps*age));
  const dist=haversine({latitude:jarvisFreeMotion.displayLat,longitude:jarvisFreeMotion.displayLon},{latitude:d.lat,longitude:d.lng});
  let gain;
  if(escape){
    // v6.14.12: during the first moments of REROUTING, transition from the snapped route
    // to real GPS instead of snapping the squid/camera across lanes. After the handoff,
    // catch up more strongly so the physical vehicle remains authoritative.
    const escapeMs=jarvisDeviationStartedAt?Date.now()-jarvisDeviationStartedAt:9999;
    if(Date.now()<jarvisDeviationGpsIsolationUntil){
      // v6.14.18: no distance-triggered catch-up burst in the handoff window.
      // A large GPS/route gap is absorbed continuously instead of creating a rabbit-hop.
      gain=acc<=15?.080:acc<=25?.065:.052;
    }else if(escapeMs<1600){
      gain=acc<=20?(dist>22?.16:.095):(dist>24?.12:.075);
    }else if(acc<=15) gain=dist>24?.24:(dist>10?.17:.11);
    else if(acc<=25) gain=dist>26?.21:(dist>11?.15:.095);
    else gain=dist>28?.18:(dist>12?.13:.085);
  }else{
    gain=dist>30?.40:(dist>10?.24:.12);
  }
  if(isolated){
    // v6.14.18: during the first five seconds after departure, do NOT spring the marker
    // toward each discrete GPS fix. That 1 Hz target chasing is what looks like a rabbit hop.
    // Instead the marker behaves like a small vehicle: speed changes are acceleration-limited,
    // heading turns gradually, and GPS error is only bled off with a slow capped correction.
    const desiredV=Math.max(0,Math.min(32,jarvisFreeMotion.speedMps));
    const maxAccel=2.6; // m/s^2 visual acceleration limit
    const dv=Math.max(-maxAccel*dt,Math.min(maxAccel*dt,desiredV-(jarvisFreeMotion.renderSpeedMps||0)));
    jarvisFreeMotion.renderSpeedMps=Math.max(0,(jarvisFreeMotion.renderSpeedMps||0)+dv);
    if(Number.isFinite(jarvisFreeMotion.targetHeading))
      jarvisFreeMotion.displayHeading=smoothHeading(jarvisFreeMotion.displayHeading,jarvisFreeMotion.targetHeading,1-Math.exp(-dt/1.25));
    const moveH=Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:(jarvisFreeMotion.targetHeading||0);
    const forward=jarvisFreeForward(jarvisFreeMotion.displayLat,jarvisFreeMotion.displayLon,moveH,jarvisFreeMotion.renderSpeedMps*dt);
    let nLat=forward.lat,nLng=forward.lng;
    const remain=haversine({latitude:nLat,longitude:nLng},{latitude:d.lat,longitude:d.lng});
    if(remain>.15){
      const corrBearing=bearing(nLat,nLng,d.lat,d.lng);
      const corrRate=remain>25?2.0:remain>12?1.35:.85; // m/s correction, never a jump
      const corr=jarvisFreeForward(nLat,nLng,corrBearing,Math.min(remain,corrRate*dt));
      nLat=corr.lat;nLng=corr.lng;
    }
    jarvisFreeMotion.displayLat=nLat;jarvisFreeMotion.displayLon=nLng;
  }else{
    const k=1-Math.pow(1-gain,Math.max(1,dt*60));
    let moveLat=(d.lat-jarvisFreeMotion.displayLat)*k,moveLng=(d.lng-jarvisFreeMotion.displayLon)*k;
    // v6.14.44: hard per-frame movement cap on the visible marker, mirroring the cap
    // jarvisFollowCameraUpdate's DEVIATING mode already applies to the CAMERA. The gain above is
    // intentionally distance-tiered (bigger gap -> bigger gain) so ordinary lag closes quickly,
    // but that same tiering means a gap that happens to grow past a tier threshold - e.g. because
    // only a couple of animation frames actually ran during one GPS-fix interval, as observed
    // under real CPU contention (this exact case: PARALLEL constantly re-entering OFF_ROUTE/
    // REROUTING every few fixes while several other scenarios' map objects were still alive in
    // the same tab) - gets closed in one disproportionately large frame the moment normal frame
    // delivery resumes. Capping the per-frame MARKER movement (not the gain itself) bounds that
    // worst case without changing how quickly ordinary, evenly-paced frames converge.
    const moveM=haversine({latitude:jarvisFreeMotion.displayLat,longitude:jarvisFreeMotion.displayLon},{latitude:jarvisFreeMotion.displayLat+moveLat,longitude:jarvisFreeMotion.displayLon+moveLng});
    const maxFrameMoveM=Math.max(2.5,(Math.max(6,Number(currentSpeedKmh)||0)/3.6)*dt*4.5);
    if(moveM>maxFrameMoveM&&moveM>0){const r=maxFrameMoveM/moveM;moveLat*=r;moveLng*=r;}
    jarvisFreeMotion.displayLat+=moveLat;jarvisFreeMotion.displayLon+=moveLng;
    if(Number.isFinite(jarvisFreeMotion.targetHeading))
      jarvisFreeMotion.displayHeading=smoothHeading(jarvisFreeMotion.displayHeading,jarvisFreeMotion.targetHeading,escape?(acc<=20?.12:.09):(jarvisFreeMotion.speedMps>2?.08:.055));
  }
  const mh=headingUpMode&&Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:0;
  navSquidOverlay?.setPosition(jarvisFreeMotion.displayLat,jarvisFreeMotion.displayLon,headingUpMode?0:(jarvisFreeMotion.displayHeading||0));
  if(now-jarvisFreeMotion.lastCameraAt>=70){
    jarvisFreeMotion.lastCameraAt=now;
    const camHeading=Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:(jarvisTravelHeading()||0);
    // Preserve the v6.14.8 adaptive zoom policy, but apply it to the route-independent
    // display location instead of the route-projected pose.
    const displayZoom=(navSessionStarted&&navMode==='ROUTE')?jarvisAdaptiveNavZoom(jarvisCurrentGuidanceEvent()):18;
    const cc=jarvisCameraCenterAhead(jarvisFreeMotion.displayLat,jarvisFreeMotion.displayLon,camHeading,displayZoom);
    jarvisFollowCameraUpdate(cc.lat,cc.lng,camHeading,displayZoom,now,false);
  }
 };jarvisFreeMotion.raf=requestAnimationFrame(tick);
}




function jarvisSetRouteGuidanceAppearance(active=true){
  try{
    navRouteLine?.setOptions?.({strokeOpacity:active?.98:.22,strokeWeight:active?11:7});
  }catch(e){}
}

function jarvisEnterDeviationEscape(reason='OFF_ROUTE'){
  if(jarvisDeviationEscape)return;
  jarvisDeviationEscape=true;
  jarvisDeviationStartedAt=Date.now();
  jarvisDeviationGpsIsolationUntil=jarvisDeviationStartedAt+5000;
  jarvisPendingRouteRejoin=false;
  jarvisPendingRouteRejoinFixes=0;
  jarvisPendingRouteRejoinStartedAt=0;
  // v6.14.19: display-location ownership never changes at deviation. The same
  // route-independent estimator has already been following accepted GPS fixes while TRACKING,
  // so OFF_ROUTE/REROUTING only changes guidance state and camera policy.
  if(!Number.isFinite(jarvisFreeMotion.displayLat)&&typeof currentLat==='number'&&typeof currentLon==='number'){
    jarvisFreeMotion.displayLat=currentLat;jarvisFreeMotion.displayLon=currentLon;
    jarvisFreeMotion.displayHeading=jarvisTravelHeading()||0;
  }
  if(typeof currentLat==='number'&&typeof currentLon==='number'){
    jarvisFreeMotion.targetLat=currentLat;jarvisFreeMotion.targetLon=currentLon;
  }
  const travel=jarvisTravelHeading();if(Number.isFinite(travel))jarvisFreeMotion.targetHeading=travel;
  jarvisFreeMotion.renderSpeedMps=Math.max(0,Math.min(32,(Number(currentSpeedKmh)||0)/3.6));
  jarvisFreeMotion.lastFixAt=performance.now();
  // Preserve the on-screen camera pose. Resetting here caused an immediate jump to the
  // new GPS/course target in heading-up mode. Instead, enter a deliberate zoom-out/rotate phase.
  jarvisSetRerouteCameraMode('DEVIATING');
  jarvisFreeMotionStart();
  jarvisClearTurnArrow?.();
  jarvisSetRouteGuidanceAppearance(false); // stale route remains only as a quiet reference while rerouting
  jarvisSetStatus(reason==='HEADING'?'進行方向を変更：現在位置を追従しながら再検索中…':'ルート逸脱：現在位置を追従しながら再検索中…','warn');
}
function jarvisExitDeviationEscape(){
  if(jarvisRerouteCamera.mode==='DEVIATING'&&!jarvisPendingRouteRejoin)jarvisSetRerouteCameraMode('NORMAL');
  jarvisDeviationEscape=false;
  jarvisVisualGpsPriority=false;
  jarvisVisualOnRouteFixes=0;
  jarvisDeviationEvidence=0;
  jarvisDeviationStartedAt=0;
  jarvisDeviationGpsIsolationUntil=0;
  jarvisPendingRouteRejoin=false;
  jarvisPendingRouteRejoinFixes=0;
  jarvisPendingRouteRejoinStartedAt=0;
  jarvisExitUTurnRecovery();
  jarvisSetRouteGuidanceAppearance(true);
}

function jarvisMotionReset(keepFrame=false){
  jarvisMotion.path=null;
  jarvisMotion.pts=null;
  jarvisMotion.cum=null;
  jarvisMotion.total=0;
  jarvisMotion.targetS=null;
  jarvisMotion.displayS=null;
  jarvisMotion.lastFixAt=0;
  jarvisMotion.speedMps=0;
  jarvisMotion.displayHeading=null;
  jarvisMotion.lastProjection=null;
  jarvisMotion.lastFrameAt=0;
  jarvisMotion.lastCameraAt=0;
  jarvisDepartureFixes=0;
  jarvisMotionDiag.projectionS=null;
  jarvisMotionDiag.candidateS=null;
  jarvisMotionDiag.projectionDistance=null;
  jarvisMotionDiag.localCorridorUsed=null;
  jarvisMotionDiag.localCorridorDistance=null;
  jarvisMotionDiag.fallbackDistance=null;
  jarvisMotionDiag.mismatch=null;
  jarvisMotionDiag.departureCandidate=false;
  jarvisMotionDiag.departureFixes=0;
  jarvisMotionDiag.visualThreshold=null;
  if(!keepFrame&&jarvisMotion.raf){
    cancelAnimationFrame(jarvisMotion.raf);
    jarvisMotion.raf=null;
  }
}

// ===== v6.14.12 route geometry stabilizer =====
// Google Routes HIGH_QUALITY remains the source of truth.  We only remove tiny
// sub-lane zigzags that are visually noisy and can make segment-by-segment map matching
// oscillate. Genuine bends/intersections are preserved by a strict lateral-deviation cap.
function jarvisPointLineDeviationMeters(a,b,p){
  const R=6371000,rad=Math.PI/180,lat0=p.lat*rad,cos=Math.max(.15,Math.cos(lat0));
  const ax=(a.lng-p.lng)*rad*cos*R,ay=(a.lat-p.lat)*rad*R;
  const bx=(b.lng-p.lng)*rad*cos*R,by=(b.lat-p.lat)*rad*R;
  const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
  let u=den>0?-(ax*dx+ay*dy)/den:0;u=Math.max(0,Math.min(1,u));
  return Math.hypot(ax+u*dx,ay+u*dy);
}
function jarvisStabilizeRoutePath(base){
  const src=(base||[]).map(jarvisNormalizePathPoint).filter(Boolean);
  if(src.length<3)return src;
  let pts=src.slice();
  // Two conservative passes. Only remove a middle point when the direct chord is short
  // and the point is within roughly one metre of it. This suppresses encoded-polyline
  // micro-zigzags without rounding real road corners or ramp geometry.
  for(let pass=0;pass<2;pass++){
    const out=[pts[0]];
    for(let i=1;i<pts.length-1;i++){
      const a=out[out.length-1],p=pts[i],b=pts[i+1];
      const ap=haversine({latitude:a.lat,longitude:a.lng},{latitude:p.lat,longitude:p.lng});
      const pb=haversine({latitude:p.lat,longitude:p.lng},{latitude:b.lat,longitude:b.lng});
      const ab=haversine({latitude:a.lat,longitude:a.lng},{latitude:b.lat,longitude:b.lng});
      const dev=jarvisPointLineDeviationMeters(a,b,p);
      const shortMicro=(ap<=18&&pb<=18&&ab<=36&&dev<=1.8);
      const duplicate=(ap<0.65)||(pb<0.65);
      if(shortMicro||duplicate)continue;
      out.push(p);
    }
    out.push(pts[pts.length-1]);
    pts=out;
  }
  return pts;
}
function jarvisMotionPath(){
  return (routeCandidates[selectedRouteIndex]||routeData)?.path||null;
}

function jarvisMotionPreparePath(){
  const path=jarvisMotionPath();
  if(!Array.isArray(path)||path.length<2)return false;
  if(jarvisMotion.path===path&&jarvisMotion.pts?.length===path.length)return true;

  const pts=path.map(jarvisNormalizePathPoint).filter(Boolean);
  if(pts.length<2)return false;
  const cum=[0];
  for(let i=1;i<pts.length;i++){
    cum[i]=cum[i-1]+haversine(
      {latitude:pts[i-1].lat,longitude:pts[i-1].lng},
      {latitude:pts[i].lat,longitude:pts[i].lng}
    );
  }
  jarvisMotion.path=path;
  jarvisMotion.pts=pts;
  jarvisMotion.cum=cum;
  jarvisMotion.total=cum[cum.length-1];
  jarvisMotion.targetS=null;
  jarvisMotion.displayS=null;
  jarvisMotion.lastProjection=null;
  return true;
}

// ===== v6.14.54: unified route projection/matching core =====
// A single bounded map-matching implementation used by every consumer that needs "where on a
// route is this lat/lon": the display projection (jarvisMotionProject), reroute evidence
// (jarvisNearestActiveRoute), and original-route rejoin detection (jarvisMatchOriginalRoute).
// Previously these were three independently-tuned algorithms, two of which fell back to an
// UNBOUNDED full-route scan when no close local candidate existed — the documented cause of a
// real road test matching a physically-close-but-kilometers-away segment on a route with
// overlapping/near-parallel geometry (a fix ~775m along the route was matched to a candidate
// ~7.5km further along, because the far segment's proximity outweighed a capped continuity
// penalty). There is now exactly one corridor rule, a hard distance cutoff, and no unbounded
// fallback anywhere in this file.
function jarvisRouteProgressWindow(anchorS,speedKmh){
  if(!Number.isFinite(anchorS))return{lo:0,hi:Infinity};
  const speedMps=Math.max(0,(Number(speedKmh)||0)/3.6);
  const back=Math.max(40,speedMps*3+25);
  const forward=Math.max(220,speedMps*11+160);
  return{lo:Math.max(0,anchorS-back),hi:anchorS+forward};
}
// pts/cum/total: a prepared polyline (see jarvisMotionPreparePath / jarvisPrepareOriginalRouteSnapshot).
// anchorS: current authoritative progress on THIS path, or null before the first fix on it.
// accuracyM: the GPS fix's own reported accuracy (optional) — v6.14.55 uses it to scale how much
// the tight, heading-blind stage is trusted (a fuzzy fix has a wider true-position radius, so a
// nearby parallel road/side street/ramp is a real ambiguity risk, not just noise).
// Returns null when nothing qualifies inside the bounded window — callers must treat that as
// "off corridor" (visual GPS priority / off-route evidence), never fall back to an unbounded scan.
function jarvisCorridorMatch(pts,cum,total,lat,lon,anchorS,speedKmh,travel,accuracyM){
  const R=6371000,rad=Math.PI/180,lat0=Number(lat)*rad,cos=Math.max(.15,Math.cos(lat0));
  const{lo,hi}=jarvisRouteProgressWindow(anchorS,speedKmh);
  const hasAnchor=Number.isFinite(anchorS);
  const acc=Number.isFinite(accuracyM)&&accuracyM>0?accuracyM:12;
  // v6.14.55: composite snapping. Stage 1 stays tight and heading-blind at an intersection/turn
  // (v6.14.27's rationale: the physical fix sits almost exactly on the correct segment before
  // travel heading catches up to the new road tangent), but its radius now scales down with GPS
  // accuracy instead of a fixed 6m — a fuzzy fix that happens to land within a lax radius of a
  // parallel road/ramp/side street must not be trusted as blindly as a crisp one. A fix whose
  // course is confidently near-opposite to a segment (>150°, i.e. the reverse/parallel
  // carriageway, not a turn-in-progress) is excluded from the tight stage regardless of distance.
  const tightRadius=Math.min(6,Math.max(3,acc*0.4));
  let tight=null,tightScore=Infinity;
  // Stage 2: wider corridor + heading + a mild accuracy-scaled distance penalty, protects
  // divided/parallel-carriageway and ramp/side-street selection when nothing qualifies for stage 1.
  let wide=null,wideScore=Infinity;

  for(let i=1;i<pts.length;i++){
    const segStart=cum[i-1],segEnd=cum[i];
    if(segEnd<lo||segStart>hi)continue;
    const a=pts[i-1],b=pts[i];
    const ax=(a.lng-lon)*rad*cos*R,ay=(a.lat-lat)*rad*R;
    const bx=(b.lng-lon)*rad*cos*R,by=(b.lat-lat)*rad*R;
    const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;
    let u=den>0?-(ax*dx+ay*dy)/den:0;u=Math.max(0,Math.min(1,u));
    const x=ax+u*dx,y=ay+u*dy,d=Math.hypot(x,y);
    const segLen=Math.max(.01,segEnd-segStart),s=segStart+segLen*u;
    if(s<lo||s>hi)continue;
    const point={lat:lat+y/R/rad,lng:lon+x/R/rad/cos,distance:d,s,segmentIndex:i-1,u};
    const segHeading=bearing(a.lat,a.lng,b.lat,b.lng);
    const confidentHeading=Number.isFinite(travel)&&Number(speedKmh)>=6;
    const oppositeCarriageway=confidentHeading&&jarvisHeadingMismatch(travel,segHeading)>150;

    if(d<=tightRadius&&!oppositeCarriageway){
      const backPenalty=hasAnchor&&s<anchorS-3?(anchorS-3-s)*4:0;
      const score=d+backPenalty-s*1e-6; // slight forward-progress bias on near-exact ties
      if(score<tightScore){tightScore=score;tight=point;}
    }

    let headingPenalty=0;
    if(Number.isFinite(travel)&&Number(speedKmh)>=4){
      const mm=jarvisHeadingMismatch(travel,segHeading);
      if(mm>115)headingPenalty=260;else if(mm>85)headingPenalty=110;else if(mm>55)headingPenalty=35;
    }
    const backPenalty2=hasAnchor&&s<anchorS-3?(anchorS-3-s)*.6:0;
    // Distance beyond what the fix's own accuracy can explain is weaker evidence for this
    // segment than the same raw distance would be with a crisp fix — nudges selection toward a
    // slightly-farther-but-better-aligned candidate over a close-but-wrong-road one when GPS is fuzzy.
    const accuracyPenalty=Math.max(0,d-acc)*0.12;
    const score2=d+headingPenalty+backPenalty2+accuracyPenalty;
    if(score2<wideScore){wideScore=score2;wide=Object.assign({heading:segHeading},point);}
  }

  // Note: no distance cutoff here. The window above already bounds WHICH route segments are
  // candidates (by progress, not raw proximity), so a large returned distance here is genuine,
  // correct evidence that the rider is far from the route near their current progress — it must
  // reach jarvisNearestActiveRoute uncapped for off-route/reroute evidence to keep accumulating as
  // the rider drives further away. Display-only consumers (jarvisMotionProject) apply their own
  // cutoff on the result instead of this shared core silently returning null.
  const chosen=tight||wide;
  if(!chosen)return null;
  if(!Number.isFinite(chosen.heading)){
    const i=Math.min(chosen.segmentIndex+1,pts.length-1);
    chosen.heading=bearing(pts[chosen.segmentIndex].lat,pts[chosen.segmentIndex].lng,pts[i].lat,pts[i].lng);
  }
  chosen.localCorridorUsed=!!tight;
  return chosen;
}

function jarvisMotionProject(lat,lon,accuracyM){
  if(!jarvisMotionPreparePath())return null;
  const travel=jarvisTravelHeading();
  const acc=Number.isFinite(accuracyM)?accuracyM:Number(lastPos?.coords?.accuracy);
  const raw=jarvisCorridorMatch(jarvisMotion.pts,jarvisMotion.cum,jarvisMotion.total,lat,lon,jarvisMotion.targetS,currentSpeedKmh,travel,acc);
  // Display-only cutoff: never visually snap the vehicle marker onto a route point more than
  // 120m away, even though jarvisCorridorMatch itself no longer caps distance (reroute evidence
  // needs the uncapped value — see jarvisNearestActiveRoute/jarvisCorridorMatch's own comment).
  const best=(raw&&raw.distance<=120)?raw:null;
  jarvisMotionDiag.localCorridorUsed=best?best.localCorridorUsed:null;
  jarvisMotionDiag.localCorridorDistance=(best&&best.localCorridorUsed)?best.distance:null;
  jarvisMotionDiag.fallbackDistance=(best&&!best.localCorridorUsed)?best.distance:null;
  jarvisMotionDiag.candidateS=raw?raw.s:null;
  jarvisMotionDiag.projectionDistance=best?best.distance:null;
  return best;
}

function jarvisMotionPointAtS(s){
  if(!jarvisMotionPreparePath())return null;
  const pts=jarvisMotion.pts,cum=jarvisMotion.cum;
  s=Math.max(0,Math.min(jarvisMotion.total,Number(s)||0));
  let lo=0,hi=cum.length-1;
  while(lo+1<hi){
    const mid=(lo+hi)>>1;
    if(cum[mid]<=s)lo=mid;else hi=mid;
  }
  const a=pts[lo],b=pts[Math.min(lo+1,pts.length-1)];
  const len=Math.max(.001,cum[Math.min(lo+1,cum.length-1)]-cum[lo]);
  const u=Math.max(0,Math.min(1,(s-cum[lo])/len));
  return {lat:a.lat+(b.lat-a.lat)*u,lng:a.lng+(b.lng-a.lng)*u,s};
}

function jarvisMotionHeadingAtS(s){
  if(!jarvisMotionPreparePath())return jarvisTravelHeading()||0;
  const ss=Math.max(0,Math.min(jarvisMotion.total,Number(s)||0));
  // Use a road tangent over a meaningful window instead of the next tiny polyline segment.
  // This prevents the squid/camera heading from following every small vertex wiggle.
  const speed=Math.max(0,Number(currentSpeedKmh)||0);
  const back=speed>=35?10:7, forward=speed>=35?28:20;
  const p1=jarvisMotionPointAtS(Math.max(0,ss-back));
  const p2=jarvisMotionPointAtS(Math.min(jarvisMotion.total,ss+forward));
  if(!p1||!p2)return jarvisTravelHeading()||0;
  if(Math.abs(p1.lat-p2.lat)<1e-9&&Math.abs(p1.lng-p2.lng)<1e-9)return jarvisTravelHeading()||0;
  return bearing(p1.lat,p1.lng,p2.lat,p2.lng);
}


function jarvisNorm180(v){return ((+v||0)+540)%360-180;}
function jarvisTurnManeuver(step){
  const ni=step?.navigationInstruction||step?.navigationInstructions||null;
  return String(ni?.maneuver||step?.maneuver||'').toUpperCase();
}
function jarvisTurnDir(step){
  const m=jarvisTurnManeuver(step);
  // Ordinary intersection turn only. Exit/fork/keep are a separate guidance class.
  if(!m||/(KEEP|MERGE|FORK|RAMP|STRAIGHT|CONTINUE|ROUNDABOUT|DESTINATION)/.test(m))return null;
  if(/U[_-]?TURN|UTURN/.test(m))return null;
  if(/LEFT/.test(m))return'LEFT';
  if(/RIGHT/.test(m))return'RIGHT';
  return null;
}
function jarvisManeuverDir(m){
  m=String(m||'').toUpperCase();
  if(/LEFT/.test(m))return'LEFT';
  if(/RIGHT/.test(m))return'RIGHT';
  return null;
}
function jarvisStepInstruction(step){
  const ni=step?.navigationInstruction||step?.navigationInstructions||null;
  return jarvisCleanInstruction(ni?.instructions||step?.instructions||'');
}
function jarvisInstructionClass(step){
  const t=jarvisStepInstruction(step);
  const u=t.toUpperCase();
  if(!t)return null;

  // Google Maps JS can return a generic maneuver (SLIGHT/STRAIGHT/NAME_CHANGE)
  // while the human-readable instruction still clearly says "exit/ramp/fork".
  // Rescue those cases instead of throwing the guidance away.
  if(/出口|降り口|降りる|ランプ|EXIT|OFF[-_ ]?RAMP|RAMP/.test(u))return'EXIT';
  if(/分岐|FORK|KEEP\s+(LEFT|RIGHT)|LEFT\s+FORK|RIGHT\s+FORK/.test(u))return'DIVERGE';
  if(/合流|MERGE/.test(u))return'MERGE';

  // Japanese route instructions often express a branch as "○○方面へ".
  // Treat it as a divergence only when a left/right cue is also present.
  if(/方面/.test(t) && /(左|右)/.test(t))return'DIVERGE';
  return null;
}
function jarvisInstructionDir(step){
  const t=jarvisStepInstruction(step);
  const u=t.toUpperCase();
  // Prefer explicit text direction if maneuver itself is generic.
  if(/左|LEFT/.test(u))return'LEFT';
  if(/右|RIGHT/.test(u))return'RIGHT';
  return null;
}
function jarvisTurnStrength(step){
  const m=jarvisTurnManeuver(step);
  const byText=jarvisInstructionClass(step);

  // Instruction text gets first chance for exit/fork/merge because the
  // Maps JS maneuver may be generic at Japanese interchanges.
  if(byText)return byText;

  if(!m)return'MISSING';
  if(/U[_-]?TURN|UTURN|ROUNDABOUT|DESTINATION/.test(m))return'NO';
  if(/EXIT|OFF[_-]?RAMP|RAMP/.test(m))return'EXIT';
  if(/FORK|KEEP/.test(m))return'DIVERGE';
  if(/MERGE/.test(m))return'MERGE';
  if(/SLIGHT/.test(m)&&/(LEFT|RIGHT)/.test(m))return'SLIGHT';
  if(/(LEFT|RIGHT)/.test(m))return'HARD';
  if(/STRAIGHT|CONTINUE|NAME_CHANGE|DEPART/.test(m))return'NO';
  return'NO';
}
function jarvisGuidanceKind(strength){
  if(strength==='EXIT')return'EXIT';
  if(strength==='DIVERGE')return'DIVERGE';
  if(strength==='MERGE')return'MERGE';
  return'TURN';
}
function jarvisGuidanceVoiceText(ev,level){
  const dir=ev?.dir;
  if(ev?.kind==='EXIT'){
    if(level==='approach')return dir==='LEFT'?'まもなく左の出口です':dir==='RIGHT'?'まもなく右の出口です':'まもなく出口です';
    return dir==='LEFT'?'左の出口です':dir==='RIGHT'?'右の出口です':'出口です';
  }
  if(ev?.kind==='DIVERGE'){
    if(level==='approach')return dir==='LEFT'?'まもなく左方向です':dir==='RIGHT'?'まもなく右方向です':'まもなく分岐です';
    return dir==='LEFT'?'左方向です':dir==='RIGHT'?'右方向です':'分岐です';
  }
  if(ev?.kind==='MERGE'){
    return level==='approach'?'まもなく合流します':'合流します';
  }
  if(level==='approach')return dir==='RIGHT'?'まもなく右折です':'まもなく左折です';
  return dir==='RIGHT'?'右折です':'左折です';
}
function jarvisRefineTurnS(baseS,dir){
  let bestS=baseS,bestScore=-Infinity;
  for(let ds=-26;ds<=26;ds+=1){
    const s=Math.max(6,Math.min(jarvisMotion.total-6,baseS+ds));
    const delta=jarvisNorm180(jarvisMotionHeadingAtS(s+6)-jarvisMotionHeadingAtS(s-6));
    const signOK=(dir==='RIGHT'&&delta>0)||(dir==='LEFT'&&delta<0);
    const score=(signOK?Math.abs(delta):Math.abs(delta)*.12)-Math.abs(ds)*.07;
    if(score>bestScore){bestScore=score;bestS=s;}
  }
  return bestS;
}
function jarvisTurnSpan(centerS,dir){
  const sign=dir==='RIGHT'?1:-1;
  const from=Math.max(0,centerS-40),to=Math.min(jarvisMotion.total,centerS+58),step=2;
  const samples=[];
  for(let s=from;s<=to+.01;s+=step)samples.push({s,heading:jarvisMotionHeadingAtS(s)});
  if(samples.length<4)return{startS:Math.max(0,centerS-1),endS:Math.min(jarvisMotion.total,centerS+7),turnDeg:0};
  let total=0;const inc=[];
  for(let i=1;i<samples.length;i++){
    const d=jarvisNorm180(samples[i].heading-samples[i-1].heading)*sign;
    const v=d>0?Math.min(22,d):0;
    inc.push(v);total+=v;
  }
  if(total<10)return{startS:Math.max(0,centerS-1),endS:Math.min(jarvisMotion.total,centerS+9),turnDeg:total};
  const lo=total*.08,hi=total*.94;let acc=0,startS=centerS,endS=centerS,gotStart=false;
  for(let i=0;i<inc.length;i++){
    acc+=inc[i];
    if(!gotStart&&acc>=lo){startS=samples[i].s;gotStart=true;}
    if(acc>=hi){endS=samples[Math.min(i+1,samples.length-1)].s;break;}
  }
  startS=Math.min(startS,centerS);
  endS=Math.max(endS,centerS+3);
  return{startS,endS,turnDeg:total};
}
function jarvisTurnEvents(){
  if(!jarvisMotionPreparePath())return[];
  const steps=jarvisVoiceSteps(),out=[];
  for(let i=0;i<steps.length;i++){
    const st=steps[i],strength=jarvisTurnStrength(st),m=jarvisTurnManeuver(st);
    if(strength==='NO')continue;

    const e=jarvisVoiceManeuverPoint(st);if(!e)continue;
    const p=jarvisMotionProject(e.latitude,e.longitude);if(!p)continue;

    const before=jarvisMotionHeadingAtS(Math.max(0,p.s-13));
    const after=jarvisMotionHeadingAtS(Math.min(jarvisMotion.total,p.s+15));
    const geom=jarvisNorm180(after-before);

    let dir=jarvisTurnDir(st);
    const kind=jarvisGuidanceKind(strength);

    // Exit/fork/keep are not ordinary turns. Trust Google's maneuver category and
    // use geometry only to locate the visible branch, not to suppress the event.
    if(kind==='EXIT'||kind==='DIVERGE'){
      dir=jarvisManeuverDir(m) || jarvisInstructionDir(st) || (Math.abs(geom)>=5?(geom>0?'RIGHT':'LEFT'):null);
      const fallbackDir=dir || (geom>=0?'RIGHT':'LEFT');
      const turnS=jarvisRefineTurnS(p.s,fallbackDir);
      let span=jarvisTurnSpan(turnS,fallbackDir);

      // Very shallow exits can look almost straight. Keep a compact branch arrow anyway.
      if(span.turnDeg<8){
        span={
          startS:Math.max(0,p.s-5),
          endS:Math.min(jarvisMotion.total,p.s+22),
          turnDeg:Math.abs(geom)
        };
      }
      out.push({
        stepIndex:i,s:p.s,startS:span.startS,endS:span.endS,
        // v6.14.44 VOICE TRUTH: key identifies the maneuver only (route step index + kind), not
        // a recomputed distance-along-route value. `s`/`turnS` are refined from the live route
        // geometry using windows that depend on the vehicle's *current* speed
        // (jarvisMotionHeadingAtS), so their rounded value can shift by a metre or two between
        // consecutive calls as speed changes while approaching the same physical junction. A key
        // built from that value could silently change mid-approach, defeating voiceAnnounced
        // de-duplication and re-announcing the same stage twice ("voice duplicate").
        turnDeg:span.turnDeg,dir,key:`${i}:${kind}`,
        source:strength,maneuver:m,kind
      });
      continue;
    }

    if(kind==='MERGE'){
      // v6.14.7: only Google's explicit MERGE owns merge guidance. Instruction-text rescue alone
      // can describe traffic joining from the side even when *our* route stays on the mainline.
      if(!/MERGE/.test(m))continue;
      dir=jarvisManeuverDir(m) || jarvisInstructionDir(st) || (Math.abs(geom)>=7?(geom>0?'RIGHT':'LEFT'):null);
      out.push({
        stepIndex:i,s:p.s,startS:Math.max(0,p.s-18),endS:Math.min(jarvisMotion.total,p.s+38),
        turnDeg:Math.abs(geom),dir,key:`${i}:${kind}`,
        source:'MERGE_EXPLICIT',maneuver:m,kind
      });
      continue;
    }

    // Normal intersection logic: still conservative to suppress false LEFT/RIGHT.
    if(!dir&&strength==='MISSING'){
      if(Math.abs(geom)<32)continue;
      dir=geom>0?'RIGHT':'LEFT';
    }
    if(!dir)continue;

    const sameSign=(dir==='RIGHT'&&geom>0)||(dir==='LEFT'&&geom<0);
    if(!sameSign)continue;

    const turnS=jarvisRefineTurnS(p.s,dir);
    const span=jarvisTurnSpan(turnS,dir);
    const spanLen=Math.max(1,span.endS-span.startS);
    const density=span.turnDeg/spanLen;

    if(strength==='HARD'){
      if(Math.abs(geom)<10||span.turnDeg<12)continue;
      if(spanLen>82&&density<.20)continue;
    }else if(strength==='SLIGHT'){
      if(Math.abs(geom)<20||span.turnDeg<22)continue;
      if(spanLen>72&&density<.34)continue;
    }else{
      if(Math.abs(geom)<32||span.turnDeg<32)continue;
      if(spanLen>64&&density<.46)continue;
    }

    out.push({
      stepIndex:i,s:turnS,startS:span.startS,endS:span.endS,
      turnDeg:span.turnDeg,dir,key:`${i}:TURN`,
      source:strength,maneuver:m,kind:'TURN'
    });
  }
  return out.sort((a,b)=>a.s-b.s);
}
// v6.14.26 GUIDANCE CENTER: guidance distance is measured from the maneuver CENTER (e.s),
// not the start of the visible white-arrow/turn-span geometry (e.startS). Using startS made
// the announced/zoom distance reach 0m before the junction and go negative while still inside
// the turn span. startS/endS are unchanged and continue to define the visible arrow window.
function jarvisNextTurnInfo(){if(!navSessionStarted||jarvisDeviationEscape||!Number.isFinite(jarvisMotion.displayS))return null;for(const e of jarvisTurnEvents()){const d=e.s-jarvisMotion.displayS;if(jarvisMotion.displayS<=e.endS+5)return{...e,distance:d};}return null;}
// v6.14.55: the cache window (v6.14.7's own "one noisy GPS projection must not make guidance
// disappear" safety net) was too short to survive a multi-fix visual-GPS-priority episode — a
// perfectly ordinary few seconds of GPS noise, not a real deviation — during which
// jarvisMotion.displayS stops advancing (route-progress ownership is held by the free/GPS
// estimator, see jarvisMotionAcceptFix). That silently dropped voice/arrow guidance for a
// maneuver that was already generated, well before the rider actually needed to be told again.
// Widened from 1200ms/+3m to 3500ms/+15m tolerance; still bounded so guidance for a truly-passed
// turn does not linger indefinitely. Never serves the cache during a genuine off-route escape —
// that suppression (see jarvisNextTurnInfo) must stay honest.
function jarvisCurrentGuidanceEvent(){
  const live=jarvisNextTurnInfo();
  const now=performance.now();
  if(live){jarvisGuidanceCache=live;jarvisGuidanceCacheAt=now;return live;}
  if(!jarvisDeviationEscape&&jarvisGuidanceCache&&now-jarvisGuidanceCacheAt<=3500&&Number.isFinite(jarvisMotion.displayS)&&jarvisMotion.displayS<=jarvisGuidanceCache.endS+15){
    return {...jarvisGuidanceCache,distance:jarvisGuidanceCache.s-jarvisMotion.displayS};
  }
  jarvisGuidanceCache=null;
  return null;
}

// v6.14.12 Google-like adaptive navigation camera.
// Google Navigation SDK publicly describes dynamic zoom/tilt that accounts for highways,
// urban areas, road density and upcoming maneuvers. Maps JS does not expose that native
// camera policy, so JARVIS approximates it from signals we actually own: maneuver class,
// vehicle speed, turn geometry and density of nearby ordinary turns.
function jarvisNearbyTurnDensityMeters(aheadM=320){
  if(!Number.isFinite(jarvisMotion.displayS))return 0;
  const s0=jarvisMotion.displayS,s1=s0+aheadM;
  let n=0;
  for(const e of jarvisTurnEvents()){
    if(e.s<s0-8)continue;
    if(e.s>s1)break;
    if(e.kind==='TURN')n++;
  }
  return n;
}
function jarvisAdaptiveNavZoom(turnInfo){
  const baseZoom=18;
  if(!turnInfo||!Number.isFinite(jarvisMotion.displayS))return baseZoom;

  // Ramps, exits, forks/keep and merges are better understood with wider context.
  // Do not do the old 70m forced zoom for these highway/grade-separated maneuvers.
  if(turnInfo.kind==='EXIT'||turnInfo.kind==='DIVERGE'||turnInfo.kind==='MERGE')return baseZoom;
  if(turnInfo.kind!=='TURN')return baseZoom;

  const d=Number(turnInfo.distance);
  if(!Number.isFinite(d)||d>95||jarvisMotion.displayS>turnInfo.endS+5)return baseZoom;

  const speedKmh=Math.max(0,(Number(jarvisMotion.speedMps)||0)*3.6);
  const spanLen=Math.max(1,(Number(turnInfo.endS)||0)-(Number(turnInfo.startS)||0));
  const turnDeg=Math.max(0,Number(turnInfo.turnDeg)||0);
  const turnDensity=turnDeg/spanLen;
  const nearbyTurns=jarvisNearbyTurnDensityMeters(320);

  // At arterial/highway-like speeds, keep the field of view wide. If the rider slows
  // for a real intersection the zoom can progressively engage, which feels closer to
  // Google's context-sensitive camera than a road-name heuristic.
  if(speedKmh>=42)return baseZoom;

  // Long, sweeping geometry is not an intersection worth magnifying.
  if(spanLen>48&&turnDensity<0.72)return baseZoom;

  // Dense/slow urban roads benefit most from a close view. Use fractional zoom levels
  // and distance bands instead of snapping 18 -> 19 at exactly 70m.
  const urbanLike=(speedKmh<=30)||(nearbyTurns>=2);
  if(d<=38)return urbanLike?18.85:18.55;
  if(d<=68)return urbanLike?18.62:18.34;
  if(d<=95&&urbanLike)return 18.28;
  return baseZoom;
}
let jarvisTurnArrowLine=null;
function jarvisClearTurnArrow(){try{jarvisTurnArrowLine?.setMap?.(null)}catch(e){}jarvisTurnArrowLine=null;}
function jarvisTurnArrowWindow(turn){
  if(!turn)return null;
  const kind=turn.kind||'TURN',deg=Math.abs(Number(turn.turnDeg)||0);
  // The white line is an explanation of the maneuver, not a fixed-distance overlay.
  // Keep/merge-like actions need no painted path; exits/forks need enough branch geometry
  // to make the split obvious; normal intersections stay compact.
  if(kind==='MERGE'||/KEEP/.test(String(turn.maneuver||'')))return null;
  if(kind==='EXIT'||kind==='DIVERGE'){
    const before=deg<18?12:16,after=deg<18?32:24;
    return{startS:Math.max(0,turn.startS-before),endS:Math.min(jarvisMotion.total,turn.endS+after),maxDistance:145,branch:true};
  }
  const sharp=deg>=70,shallow=deg<38;
  const before=sharp?14:(shallow?8:11);
  const after=sharp?18:(shallow?10:14);
  return{startS:Math.max(0,turn.startS-before),endS:Math.min(jarvisMotion.total,turn.endS+after),maxDistance:105,branch:false};
}
function jarvisUpdateTurnArrow(turn){
 if(!navGoogleMap||jarvisDeviationEscape||jarvisNavTrackingState==='REROUTING'){jarvisClearTurnArrow();return;}
 const win=jarvisTurnArrowWindow(turn);
 if(!turn||!win||turn.distance>win.maxDistance||jarvisMotion.displayS>win.endS+3){jarvisClearTurnArrow();return;}
 const pts=[],s0=win.startS,s1=win.endS;
 const count=Math.max(12,Math.min(48,Math.ceil((s1-s0)/1.7)));
 for(let i=0;i<=count;i++){const p=jarvisMotionPointAtS(s0+(s1-s0)*(i/count));if(p)pts.push({lat:p.lat,lng:p.lng});}
 if(pts.length<2){jarvisClearTurnArrow();return;}
 const icons=[{icon:{path:google.maps.SymbolPath.FORWARD_CLOSED_ARROW,scale:win.branch?5.8:5,strokeColor:'#fff',strokeWeight:2,fillColor:'#fff',fillOpacity:1},offset:'100%'}];
 const weight=win.branch?7:6;
 if(!jarvisTurnArrowLine)jarvisTurnArrowLine=new google.maps.Polyline({map:navGoogleMap,path:pts,strokeColor:'#fff',strokeOpacity:1,strokeWeight:weight,zIndex:100,clickable:false,icons});
 else{jarvisTurnArrowLine.setOptions({path:pts,strokeWeight:weight,icons});jarvisTurnArrowLine.setMap(navGoogleMap);}
}

function jarvisMotionAcceptFix(lat,lon,speedKmh,accuracyM){
  if(!navSessionStarted||navMode!=='ROUTE')return;
  const pr=jarvisMotionProject(lat,lon,accuracyM);
  const now=performance.now();
  jarvisMotion.lastFixAt=now;
  jarvisMotion.speedMps=Math.max(0,Math.min(45,(Number(speedKmh)||0)/3.6));

  // v6.14.7: Google-style separation of concerns. Location display and rerouting are
  // independent. A suspicious projection may temporarily give the squid to real GPS,
  // but it MUST NOT enter the persistent reroute/deviation state by itself.
  const acc=Number.isFinite(Number(accuracyM))?Number(accuracyM):99;
  const routeH=pr?jarvisMotionHeadingAtS(pr.s):null;
  const travel=jarvisTravelHeading();
  const mismatch=(Number.isFinite(routeH)&&Number.isFinite(travel))?jarvisHeadingMismatch(travel,routeH):0;
  const visualThreshold=Math.max(VISUAL_ESCAPE_MIN_M,Math.min(22,acc*.72));
  // v6.14.13: "departure intent" pre-empts route projection. When the rider physically
  // turns away from a straight route, the squid/camera must follow the rider BEFORE the
  // lateral distance grows. This is display ownership only; reroute still needs evidence.
  // v6.14.24 TURN GUARD: the original one-shot version could fire on a single fix during a
  // legitimate sharp turn, where route tangent changes faster than GPS/course heading settles.
  // Require BOTH a meaningful lateral separation AND a stronger heading mismatch, sustained for
  // 2 consecutive fixes, before treating it as a departure. A hard lateral escape above
  // visualThreshold (below) remains immediate, so a true departure is still caught quickly.
  const departureLateralMin=Math.max(4.5,Math.min(7.5,acc*.45));
  const departureHeadingMin=Math.max(VISUAL_ESCAPE_HEADING_DEG,50);
  const departureCandidate=!!pr && Number(speedKmh)>=6 && mismatch>departureHeadingMin && pr.distance>departureLateralMin;
  jarvisDepartureFixes=departureCandidate?jarvisDepartureFixes+1:0;
  const departureIntent=jarvisDepartureFixes>=2;
  jarvisMotionDiag.mismatch=mismatch;
  jarvisMotionDiag.departureCandidate=departureCandidate;
  jarvisMotionDiag.departureFixes=jarvisDepartureFixes;
  jarvisMotionDiag.visualThreshold=visualThreshold;
  const visuallyOff=!pr || (pr.distance>visualThreshold) || departureIntent;

  if(jarvisDeviationEscape){
    jarvisVisualGpsPriority=true;
    jarvisVisualOnRouteFixes=0;

    // v6.14.18: hard GPS-only isolation window after a confirmed departure.
    // During these first five seconds, neither the old route nor a newly computed route
    // may influence squid position, heading ownership, or rejoin counters. This mirrors
    // Google's separation between continuous location updates and the REROUTING state.
    if(Date.now() < jarvisDeviationGpsIsolationUntil){
      jarvisPendingRouteRejoinFixes=0;
      jarvisMotionStart();
      return;
    }

    // v6.14.12: Google-style rejoin gate. A newly computed route is NOT allowed to
    // take ownership of the squid merely because it exists. Real GPS keeps ownership
    // until position + travel heading agree with the new route for consecutive fixes.
    if(jarvisPendingRouteRejoin && pr){
      const rejoinDist=Math.min(14,Math.max(7,acc*.55));
      const headingOk=Number(speedKmh)<5 || mismatch<50;
      const distanceOk=pr.distance<=rejoinDist;
      if(distanceOk && headingOk) jarvisPendingRouteRejoinFixes++;
      else jarvisPendingRouteRejoinFixes=0;

      if(jarvisPendingRouteRejoinFixes>=4){
        jarvisMotion.targetS=pr.s;
        // Preserve the visible vehicle pose. Route motion takes ownership only after
        // consecutive agreement, then catches up from the nearest displayed position.
        // v6.14.45: reads the vehicle's current pose through the named VehiclePose interface
        // (jarvisGetVehiclePose) instead of reaching into jarvisFreeMotion's fields directly —
        // this is route projection CONSUMING VehiclePose, never writing it.
        const vp=jarvisGetVehiclePose();
        const visualPr=vp?jarvisMotionProject(vp.lat,vp.lng):null;
        jarvisMotion.displayS=visualPr?visualPr.s:pr.s;
        jarvisMotion.displayHeading=vp&&Number.isFinite(vp.heading)?vp.heading:jarvisMotionHeadingAtS(jarvisMotion.displayS);
        jarvisMotion.lastProjection=pr;
        // Do not reset the camera on route reacquisition. Blend from the wider off-route
        // view back to the normal adaptive zoom and route heading instead.
        jarvisSetRerouteCameraMode('REJOINING');
        jarvisExitDeviationEscape();
        jarvisNavTrackingState='TRACKING';
        jarvisSetRouteGuidanceAppearance(true);
        // v6.14.44 fix: `jarvisRenderTurnArrow` never existed (pre-existing v6.14.18 bug — the
        // real function is `jarvisUpdateTurnArrow`). Because it was called as a bare identifier,
        // `?.()` did not save it: referencing an undeclared binding throws a ReferenceError
        // regardless. That exception aborted the REST of this onPosition() call every time a
        // reroute rejoin succeeded — skipping jarvisArrivalUpdate/jarvisAutoRerouteUpdate/
        // jarvisVoiceGuideUpdate and the lastPos update for that fix. This was a major
        // contributor to PARALLEL's non-convergence and large single-step jumps: the exact
        // moment ownership was supposed to hand back to route projection was also the moment
        // processing silently broke.
        jarvisUpdateTurnArrow(jarvisCurrentGuidanceEvent());
        jarvisSetStatus('新しいルートに合流：案内を継続','ok');
      }
    }
    jarvisMotionStart();
    return;
  }

  if(visuallyOff){
    jarvisVisualGpsPriority=true;
    jarvisVisualOnRouteFixes=0;
    jarvisMotionStart();
    return;
  }

  // v6.14.13: do not let the old route immediately grab the squid back after a real turn.
  // Require a tighter corridor + heading agreement for three consecutive fixes.
  if(jarvisVisualGpsPriority){
    const confidentlyOn=!!pr && pr.distance<Math.min(8,Math.max(4.5,acc*.40)) && (Number(speedKmh)<5 || mismatch<28);
    if(confidentlyOn)jarvisVisualOnRouteFixes++; else jarvisVisualOnRouteFixes=0;
    if(jarvisVisualOnRouteFixes<4){
        jarvisMotionStart();
      return;
    }
    jarvisVisualGpsPriority=false;
    jarvisVisualOnRouteFixes=0;
    if(pr){
      jarvisMotion.targetS=pr.s;
      // v6.14.45: same VehiclePose-consuming read as the rejoin branch above.
      const vp=jarvisGetVehiclePose();
      const visualPr=vp?jarvisMotionProject(vp.lat,vp.lng):null;
      jarvisMotion.displayS=visualPr?visualPr.s:pr.s;
      jarvisMotion.displayHeading=vp&&Number.isFinite(vp.heading)?vp.heading:jarvisMotionHeadingAtS(jarvisMotion.displayS);
      jarvisMotion.lastProjection=pr;
    }
    // Preserve the camera pose when route projection regains ownership. Resetting the
    // follow camera here produced the last visible 'warp' during ownership handoff.
  }

  if(pr){
    const prevS=jarvisMotion.targetS;
    // Tight progress corridor around bends/interchanges prevents a nearby future/previous segment
    // from stealing the marker when road geometry folds back near itself.
    if(Number.isFinite(prevS)&&Number(speedKmh)>=4){
      const maxForward=Math.max(75,(Number(speedKmh)/3.6)*5.0+42);
      if(pr.s<prevS-10)pr.s=prevS-10;
      if(pr.s>prevS+maxForward)pr.s=prevS+maxForward;
    }
    jarvisMotion.targetS=pr.s;
    jarvisMotion.lastProjection=pr;
    if(!Number.isFinite(jarvisMotion.displayS)){
      jarvisMotion.displayS=pr.s;
      jarvisMotion.displayHeading=jarvisMotionHeadingAtS(pr.s);
    }
  }
  jarvisMotionStart();
}

function jarvisMotionStart(){
  if(jarvisMotion.raf)return;
  jarvisMotion.lastFrameAt=performance.now();
  const tick=(now)=>{
    jarvisMotion.raf=requestAnimationFrame(tick);
    // v6.14.44: projectionS is the single authoritative route-progress telemetry value.
    // It always mirrors jarvisMotion.targetS, whichever code path last set it (normal
    // progress, rejoin, or visual-priority reacquisition), so it can never drift out of
    // sync the way a separately-maintained "selectedS" field previously did.
    jarvisMotionDiag.projectionS=Number.isFinite(jarvisMotion.targetS)?jarvisMotion.targetS:null;
    if(!navSessionStarted||navMode!=='ROUTE'||!navGoogleMap||!navMapFollow)return;
    // Route progress continues independently of display-location ownership.
    if(!jarvisMotionPreparePath())return;

    const dt=Math.max(.001,Math.min(.08,(now-jarvisMotion.lastFrameAt)/1000));
    jarvisMotion.lastFrameAt=now;

    if(!Number.isFinite(jarvisMotion.targetS)||!Number.isFinite(jarvisMotion.displayS)){
      const pr=(typeof currentLat==='number'&&typeof currentLon==='number')?jarvisMotionProject(currentLat,currentLon):null;
      if(!pr)return;
      jarvisMotion.targetS=pr.s;
      jarvisMotion.displayS=pr.s;
      jarvisMotion.lastFixAt=now;
    }

    // 次のGPS fixまで最大1.6秒だけ道路上を速度予測。
    // 無制限に先走らないよう予測距離にも上限を置く。
    const age=Math.max(0,(now-jarvisMotion.lastFixAt)/1000);
    const predictSec=Math.min(1.6,age);
    const predictM=Math.min(35,jarvisMotion.speedMps*predictSec);
    let desiredS=Math.min(jarvisMotion.total,jarvisMotion.targetS+predictM);
    // v6.14.14: do not visually drive around the route's corner before the rider does.
    // If the predicted route bearing turns away from the real travel course, freeze route
    // look-ahead near the latest GPS projection and wait for the physical turn.
    const travelForPredict=jarvisTravelHeading();
    if(Number.isFinite(travelForPredict)&&Number(currentSpeedKmh)>=5&&Number.isFinite(jarvisMotion.targetS)){
      const predictedH=jarvisMotionHeadingAtS(desiredS);
      if(jarvisHeadingMismatch(travelForPredict,predictedH)>28)
        desiredS=Math.min(desiredS,jarvisMotion.targetS+2.5);
    }

    // critically-damped風の追従。大誤差も一発で飛ばず、毎フレーム吸収。
    const err=desiredS-jarvisMotion.displayS;
    const alpha=1-Math.exp(-5.2*dt);
    let step=err*alpha;
    const maxStep=(Math.max(6,jarvisMotion.speedMps*1.75)+Math.min(18,Math.abs(err)*.55))*dt;
    step=Math.max(-maxStep,Math.min(maxStep,step));
    jarvisMotion.displayS=Math.max(0,Math.min(jarvisMotion.total,jarvisMotion.displayS+step));

    const pose=jarvisMotionPointAtS(jarvisMotion.displayS);
    if(!pose)return;
    const hdg=jarvisMotionHeadingAtS(jarvisMotion.displayS);
    const travelHdg=jarvisTravelHeading();
    // v6.14.14: never pre-rotate into a planned turn. Heading-up follows what the bike
    // has actually started doing; route bearing is only trusted when it already agrees.
    // This also keeps a missed turn visually straight until the rider really changes course.
    let visualHdg=hdg;
    if(Number.isFinite(travelHdg)&&Number(currentSpeedKmh)>=4){
      const mm=jarvisHeadingMismatch(travelHdg,hdg);
      visualHdg=mm>18?travelHdg:smoothHeading(travelHdg,hdg,.18);
    }
    jarvisMotion.displayHeading=smoothHeading(jarvisMotion.displayHeading,visualHdg,.055);

    // v6.14.19: route motion is guidance/progress only. It may calculate route heading,
    // maneuver distance and the white maneuver line, but it must never write the vehicle
    // marker or camera center. Display position is owned exclusively by jarvisFreeMotion.
    const turnInfo=jarvisCurrentGuidanceEvent();
    jarvisUpdateTurnArrow(turnInfo);
  };
  jarvisMotion.raf=requestAnimationFrame(tick);
}

function jarvisTravelHeading(){
  if(typeof currentHeading==='number'&&isFinite(currentHeading)) return (currentHeading+360)%360;
  return null;
}
function jarvisSquidHeading(){
  const h=jarvisTravelHeading();
  if(h!==null)return h;
  if(destination&&typeof currentLat==='number'&&typeof currentLon==='number') return bearing(currentLat,currentLon,destination.lat,destination.lon);
  return 0;
}
function jarvisApplyMapOrientation(map,which){
  if(!map)return;
  const h=jarvisTravelHeading();
  const target=headingUpMode&&h!==null?h:0;
  jarvisDiagLastTarget=target;
  try{
    const vector3D=(mapViewMode==='3D');
    const tilt=vector3D?(navSessionStarted?55:45):0;
    map.setTiltInteractionEnabled?.(vector3D);
    map.setTilt?.(tilt);
    map.setHeadingInteractionEnabled?.(true);
    map.setHeading?.(target);
  }catch(e){}
  if(which==='nav'){
    jarvisHeadingDiag(map,target);
    setTimeout(()=>jarvisHeadingDiag(map,target),120);
  }
  const shell=which==='nav'?$('navMap')?.parentElement:$('landMap')?.parentElement;
  shell?.classList.toggle('heading-up',headingUpMode);
}
function jarvisUpdateHeadingButtons(){
  const label=headingUpMode?'進行↑':'北↑';
  setTextIf('headingModeBtn',label);setTextIf('landHeadingModeBtn',label);
  $('headingModeBtn')?.classList.toggle('active',headingUpMode);
  $('landHeadingModeBtn')?.classList.toggle('active',headingUpMode);
}
async function jarvisToggleHeadingMode(){
  const next=!headingUpMode;
  headingUpMode=next;
  localStorage.setItem('jarvisHeadingUpMode',headingUpMode?'1':'0');
  jarvisUpdateHeadingButtons();
  jarvisSyncMaps(true);
  const h=jarvisTravelHeading();
  setTextIf('navMapState',headingUpMode?(h===null?'GPS方位待ち（走行すると有効）':'進行方向を上'):'北を上');
}
async function jarvisInitMaps(){
  if(!(window.google&&google.maps)) return;
  try{
    if(!jarvisMapsLibrary) jarvisMapsLibrary=await google.maps.importLibrary('maps');
    jarvisRenderingType=jarvisMapsLibrary.RenderingType.VECTOR;
    const MapClass=jarvisMapsLibrary.Map;
    const n=$('navMap'),l=$('landMap');
    if(n&&!navGoogleMap){
      navGoogleMap=new MapClass(n,jarvisMapOptions());navSquidOverlay=jarvisCreateSquidOverlay(navGoogleMap);
      google.maps.event.addListenerOnce(navGoogleMap,'tilesloaded',()=>{
        const mode=jarvisRenderingLabel(navGoogleMap);
        setTextIf('navMapState',mode==='VECTOR'?'VECTOR MAP':'回転非対応（RASTER）');
        jarvisHeadingDiag(navGoogleMap,jarvisDiagLastTarget);
        jarvisSyncMaps(true);
      });
      navGoogleMap.addListener('heading_changed',()=>jarvisHeadingDiag(navGoogleMap,jarvisDiagLastTarget));
      navGoogleMap.addListener('dragstart',()=>{navMapFollow=false;navMapUserMoved=true;jarvisUpdateRecenterButton()});
      navGoogleMap.addListener('zoom_changed',()=>{if(navMapUserMoved)jarvisUpdateRecenterButton()});
      jarvisBindMapLongPress();
      jarvisRenderViaMarkers();
    }
    if(l&&!landGoogleMap){landGoogleMap=new MapClass(l,jarvisMapOptions());landSquidOverlay=jarvisCreateSquidOverlay(landGoogleMap)}
    jarvisMapsReady=!!(navGoogleMap||landGoogleMap); setTextIf('navMapState',jarvisMapsReady?'Googleマップ':'Googleマップ待機中');
    jarvisUpdateHeadingButtons();jarvisUpdateThemeButton();jarvisApplyMapView();jarvisSyncTrafficLayers();jarvisSyncMaps(true);jarvisUpdateRecenterButton();if(nearbyPlaces.length)jarvisRenderNearbyMarkers();if(navMode==='ROUTE'&&routeData)jarvisRenderRoute();
  }catch(e){setTextIf('navMapState','地図初期化エラー');setTextIf('navMapDiag','MAP ERROR '+(e?.message||''))}
}
function jarvisEnsureDestMarker(map,which){
  let marker=which==='nav'?navDestMarker:landDestMarker;
  if(!marker){marker=new google.maps.Marker({map,title:'目的地'}); if(which==='nav')navDestMarker=marker; else landDestMarker=marker}
  return marker;
}
function jarvisEnsureGuideLine(map,which){
  let line=which==='nav'?navGuideLine:landGuideLine;
  if(!line){line=new google.maps.Polyline({map,strokeColor:'#66d9ff',strokeOpacity:.72,strokeWeight:3,geodesic:true}); if(which==='nav')navGuideLine=line; else landGuideLine=line}
  return line;
}
function jarvisRoutePreviewOwnsViewport(){
  return !!(routePreviewActive&&!navSessionStarted&&navMode==='ROUTE'&&routeCandidates.length>0);
}
function jarvisUpdateRecenterButton(){
  const b=$('recenterBtn');if(!b)return;
  b.classList.toggle('following',navMapFollow);
  b.title=navMapFollow?'現在地を追従中':'現在地へ戻る';
}
function jarvisCenterOnCurrentPosition(forceZoom=true){
  // Candidate preview owns the viewport until START; GPS/recenter helpers must not overwrite fitBounds.
  if(jarvisRoutePreviewOwnsViewport())return false;
  if(!navGoogleMap||typeof currentLat!=='number'||typeof currentLon!=='number') return false;
  navMapFollow=true;navMapUserMoved=false;
  const here={lat:currentLat,lng:currentLon};
  if(navSessionStarted&&navMode==='ROUTE'){
    navGoogleMap.setZoom(18);
    jarvisMotionAcceptFix(currentLat,currentLon,currentSpeedKmh);
    jarvisMotionStart();
  }else{
    navGoogleMap.setCenter(here);
    if(forceZoom || !navGoogleMap.getZoom() || navGoogleMap.getZoom()<15) navGoogleMap.setZoom(16);
    jarvisSyncOneMap(navGoogleMap,navSquidOverlay,'nav',true);
  }
  jarvisUpdateRecenterButton();
  return true;
}
function jarvisAcquireAndRecenter(showMessage=true){
  if(!navGoogleMap){if(showMessage)setTextIf('navMapState','Googleマップ待機中');return}
  jarvisEnsureLocationTracking(false);
  navMapFollow=true;navMapUserMoved=false;jarvisUpdateRecenterButton();
  if(typeof currentLat==='number'&&typeof currentLon==='number') jarvisCenterOnCurrentPosition(false);
  if(!navigator.geolocation){if(showMessage)setTextIf('navMapState','位置情報 非対応');return}
  if(showMessage)setTextIf('navMapState','現在地を取得中…');
  navigator.geolocation.getCurrentPosition(pos=>{
    // 復帰操作では、走行計測を開始せず地図用の現在地だけ即更新する。
    currentLat=pos.coords.latitude;currentLon=pos.coords.longitude;
    jarvisCenterOnCurrentPosition(true);
    jarvisUpdateWeather();updateNav();
    if(showMessage)setTextIf('navMapState',`現在地へ復帰 ±${Math.round(pos.coords.accuracy)}m`);
  },err=>{
    if(jarvisCenterOnCurrentPosition(false)){
      if(showMessage)setTextIf('navMapState','直前の現在地へ復帰');
    }else if(showMessage){
      const msg=err?.code===1?'位置情報の許可を確認':err?.code===3?'現在地取得タイムアウト':'現在地を取得できません';
      setTextIf('navMapState',msg);
    }
  },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
}
function jarvisRecenterNav(){
  jarvisAcquireAndRecenter(true);
}
function jarvisSyncOneMap(map,squid,which,force=false){
  if(!map)return;
  const hasPos=typeof currentLat==='number'&&typeof currentLon==='number';
  if(hasPos){
    const here={lat:currentLat,lng:currentLon};
    const travelHdg=jarvisTravelHeading();
    const squidHdg=jarvisSquidHeading();

    // ROUTE走行中のnav地図は60fps motion engineだけに位置更新を任せる。
    // GPS fixごとのpanTo/setPositionが「うさぎ跳び」を再発させるため、ここでは触らない。
    const previewLocked=(which==='nav'&&jarvisRoutePreviewOwnsViewport());
    const continuousNav=(which==='nav'&&navMode==='ROUTE'&&(navSessionStarted||navMapFollow));
    if(previewLocked){
      // v6.14.18: route preview owns the viewport. Continuous GPS updates may move the
      // vehicle marker, but must not pan/zoom over fitBounds and destroy the candidate view.
      squid?.setPosition(currentLat,currentLon,headingUpMode&&travelHdg!==null?0:squidHdg);
    }else if(!continuousNav){
      jarvisApplyMapOrientation(map,which);
      squid?.setPosition(currentLat,currentLon,headingUpMode&&travelHdg!==null?0:squidHdg);
      if(which!=='nav'||navMapFollow||force){
        map.panTo(here);
        const followZoom=16;
        if(force||map.getZoom()<14)map.setZoom(followZoom);
      }
    }else{
      jarvisMotionStart();
    }
    if(destination){
      const dest={lat:destination.lat,lng:destination.lon}; jarvisEnsureDestMarker(map,which).setPosition(dest);
      if(navMode==='ADVENTURE'){jarvisEnsureGuideLine(map,which).setMap(map);jarvisEnsureGuideLine(map,which).setPath([here,dest]);}else{const g=which==='nav'?navGuideLine:landGuideLine;g?.setMap(null);}
    }else{
      (which==='nav'?navDestMarker:landDestMarker)?.setMap(null); if(which==='nav')navDestMarker=null; else landDestMarker=null;
      (which==='nav'?navGuideLine:landGuideLine)?.setMap(null); if(which==='nav')navGuideLine=null; else landGuideLine=null;
    }
  }else if(destination){jarvisApplyMapOrientation(map,which);map.setCenter({lat:destination.lat,lng:destination.lon});jarvisEnsureDestMarker(map,which).setPosition({lat:destination.lat,lng:destination.lon})}
}
function jarvisSyncMaps(force=false){
  if(!jarvisMapsReady)return;
  jarvisSyncOneMap(navGoogleMap,navSquidOverlay,'nav',force); jarvisSyncOneMap(landGoogleMap,landSquidOverlay,'land',force);
  if(mapViewMode==='3D')jarvisApplyVector3D();
}
function jarvisResizeMaps(){
  if(!(window.google&&google.maps))return;
  [navGoogleMap,landGoogleMap].forEach(m=>{if(m){google.maps.event.trigger(m,'resize');if(typeof currentLat==='number' && (m!==navGoogleMap||(!jarvisRoutePreviewOwnsViewport()&&navMapFollow)))m.setCenter({lat:currentLat,lng:currentLon})}});
}

function updateStats(){
  const ms=elapsedMs();
  $('elapsed').textContent=fmtTime(ms);
  $('distance').textContent=(totalDistanceM/1000).toFixed(2);
  const avg=ms>0?(totalDistanceM/1000)/(ms/3600000):0;
  $('avgSpeed').textContent=Math.round(avg)
}

function setDiag(id,text,kind=''){const el=$(id);el.textContent=text;el.className=kind?`diag-${kind}`:''}
function diagMsg(text,kind=''){const el=$('diagMessage');el.textContent=text;el.className='diag-msg'+(kind?` ${kind}`:'')}

// ===== v6.14.54: single Wake Lock owner =====
// Previously acquire/release/reacquire logic existed in up to four places at once (this file, plus
// three external runtime overlays each with their own reacquire timer and their own idea of "is
// navigation active"). One of them tied "wanted" to whether the NAV panel's DOM was visible rather
// than to jarvisWakeWanted() below, so switching UI tabs mid-ride — or a plain speedometer reset —
// could drop the wake lock while navSessionStarted was still true. There is now exactly one
// "wanted" predicate, one sentinel, one reacquire loop, and one best-effort fallback.
function jarvisWakeWanted(){
  return document.visibilityState==='visible'&&(navSessionStarted||running);
}

// Best-effort iOS Safari/PWA mitigation for known Screen Wake Lock gaps (the API is supported, but
// has been observed to not reliably keep the screen on in some standalone/PWA contexts). This is
// NOT a guarantee — Apple can change or block this technique at any time — navigator.wakeLock
// above remains the primary, documented mechanism. Its real-world effectiveness across iOS
// versions cannot be verified from this repository; only real-device testing can confirm it.
let jarvisWakeVideo=null,jarvisWakeCanvas=null,jarvisWakeCtx=null,jarvisWakePulseTimer=null;
function jarvisBuildWakeVideo(){
  if(jarvisWakeVideo)return jarvisWakeVideo;
  try{
    jarvisWakeCanvas=document.createElement('canvas');jarvisWakeCanvas.width=2;jarvisWakeCanvas.height=2;
    jarvisWakeCtx=jarvisWakeCanvas.getContext('2d');
    const v=document.createElement('video');
    v.muted=true;v.playsInline=true;v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');
    v.style.cssText='position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:.01;pointer-events:none;z-index:-1';
    document.body.appendChild(v);
    if(jarvisWakeCanvas.captureStream)v.srcObject=jarvisWakeCanvas.captureStream(1);
    jarvisWakeVideo=v;
  }catch(e){}
  return jarvisWakeVideo;
}
function jarvisPulseWakeCanvas(){
  if(!jarvisWakeCtx)return;
  jarvisWakeCtx.fillStyle=(Date.now()%2000<1000)?'#000':'#010101';
  jarvisWakeCtx.fillRect(0,0,2,2);
  jarvisWakePulseTimer=setTimeout(jarvisPulseWakeCanvas,800);
}
function jarvisWakeVideoEnsure(){
  if(!jarvisWakeWanted())return;
  const v=jarvisBuildWakeVideo();
  if(!jarvisWakePulseTimer)jarvisPulseWakeCanvas();
  if(v?.paused){const p=v.play?.();if(p?.catch)p.catch(()=>{});}
}
function jarvisWakeVideoStop(){
  if(jarvisWakePulseTimer){clearTimeout(jarvisWakePulseTimer);jarvisWakePulseTimer=null;}
  try{jarvisWakeVideo?.pause?.();}catch(e){}
}

let jarvisWakeRequestInFlight=null;
let jarvisWakeRetryTimer=null;
let jarvisWakeRetryCount=0;
let jarvisWakeExplicitRelease=false;
let jarvisWakeSuppressUntil=0;

function jarvisArmWakeSentinel(){
  const sentinel=wakeLock;
  if(!sentinel||typeof sentinel.addEventListener!=='function'||sentinel.__jarvisArmed)return;
  sentinel.__jarvisArmed=true;
  sentinel.addEventListener('release',()=>{
    wakeLock=null;
    $('wakeState').textContent='画面保持 OFF';$('wakeState').className='wake';setDiag('wakeDiag','OFF','warn');
    jarvisRoadTestNoteLifecycle('WAKE_LOCK_RELEASED',{});
    if(jarvisWakeExplicitRelease||Date.now()<jarvisWakeSuppressUntil||!jarvisWakeWanted())return;
    jarvisRoadTestNoteLifecycle('WAKE_LOCK_RELEASED_UNEXPECTED',{});
    jarvisScheduleWakeReacquire('sentinel-release');
  });
}
function jarvisScheduleWakeReacquire(reason){
  if(!jarvisWakeWanted()||wakeLock||jarvisWakeRequestInFlight||jarvisWakeRetryTimer)return;
  const delay=Math.min(2000,250*Math.pow(2,Math.min(jarvisWakeRetryCount,3)));
  jarvisRoadTestNoteLifecycle('WAKE_LOCK_REACQUIRE_ATTEMPT',{reason,delay,retry:jarvisWakeRetryCount});
  jarvisWakeRetryTimer=setTimeout(async()=>{
    jarvisWakeRetryTimer=null;
    await requestWakeLock();
    if(wakeLock){jarvisWakeRetryCount=0;jarvisRoadTestNoteLifecycle('WAKE_LOCK_REACQUIRED',{reason});}
    else if(jarvisWakeWanted()){jarvisWakeRetryCount++;jarvisScheduleWakeReacquire(reason);}
  },delay);
}

async function requestWakeLock(){
  if(!('wakeLock' in navigator)){
    $('wakeState').textContent='画面保持 非対応';setDiag('wakeDiag','非対応','warn');
    if(jarvisWakeWanted())jarvisWakeVideoEnsure();
    return;
  }
  if(document.visibilityState!=='visible')return;
  if(wakeLock){jarvisArmWakeSentinel();return wakeLock;}
  if(jarvisWakeRequestInFlight)return jarvisWakeRequestInFlight;
  jarvisWakeRequestInFlight=(async()=>{
    try{
      wakeLock=await navigator.wakeLock.request('screen');
      $('wakeState').textContent='画面保持 ON';$('wakeState').className='wake ok';setDiag('wakeDiag','ON','ok');
      jarvisRoadTestNoteLifecycle('WAKE_LOCK_ON',{});
      jarvisArmWakeSentinel();
    }catch(e){
      $('wakeState').textContent='画面保持 取得失敗';setDiag('wakeDiag','取得失敗','warn');
    }finally{jarvisWakeRequestInFlight=null;}
    if(jarvisWakeWanted())jarvisWakeVideoEnsure();
    if(!wakeLock&&jarvisWakeWanted())jarvisScheduleWakeReacquire('request-miss');
    return wakeLock;
  })();
  return jarvisWakeRequestInFlight;
}
async function releaseWakeLock(){
  jarvisWakeExplicitRelease=true;jarvisWakeSuppressUntil=Date.now()+900;
  if(jarvisWakeRetryTimer){clearTimeout(jarvisWakeRetryTimer);jarvisWakeRetryTimer=null;}
  jarvisWakeRetryCount=0;
  jarvisWakeVideoStop();
  try{if(wakeLock){await wakeLock.release();}}catch(e){}
  finally{wakeLock=null;jarvisWakeExplicitRelease=false;}
  $('wakeState').textContent='画面保持 OFF';$('wakeState').className='wake';setDiag('wakeDiag','OFF','')
}

function jarvisIsNavVisible(){
  const panel=$('navPanel');
  return !!panel && !panel.classList.contains('hidden') && document.body.classList.contains('nav-mode');
}
function jarvisLocationTrackingWanted(){
  return jarvisIsNavVisible() || running || navSessionStarted;
}
function jarvisEnsureLocationTracking(showMessage=false){
  if(!window.isSecureContext){
    if(showMessage)setTextIf('navMapState','HTTPSが必要');
    return false;
  }
  if(!navigator.geolocation){
    if(showMessage)setTextIf('navMapState','位置情報 非対応');
    return false;
  }
  if(watchId===null){
    try{
      startWatch();
      jarvisLocationTrackingActive=true;
      setDiag('gpsState','追跡中','ok');
      if(showMessage)setTextIf('navMapState','現在地を追跡中');
    }catch(e){
      jarvisLocationTrackingActive=false;
      if(showMessage)setTextIf('navMapState','位置追跡を開始できません');
      return false;
    }
  }else jarvisLocationTrackingActive=true;
  return true;
}
function jarvisStopLocationTrackingIfIdle(){
  if(jarvisLocationTrackingWanted())return;
  if(watchId!==null){
    navigator.geolocation.clearWatch(watchId);
    watchId=null;
  }
  jarvisLocationTrackingActive=false;
}
async function jarvisSyncWakeLock(){
  if(document.visibilityState!=='visible')return;
  // v6.14.54: tied to navSessionStarted (an actual navigation session), not to whether the NAV
  // panel DOM happens to be visible — switching to the other tab mid-ride must not drop this.
  if(jarvisWakeWanted())await requestWakeLock();
  else await releaseWakeLock();
}
// Single watchdog: the canonical visibilitychange/pageshow handlers below already call
// jarvisSyncWakeLock() on every resume; this interval is the safety net for a sentinel that dies
// silently without the browser ever firing a 'release' event, and for regaining OS-level focus
// without a visibility change.
setInterval(()=>{
  if(!jarvisWakeWanted())return;
  // v6.14.55: WakeLockSentinel.released is a real, readable property that reflects reality even
  // on an iOS Safari/PWA build where the sentinel's own 'release' event has been observed to not
  // always fire — relying on the event alone left a stale, still-truthy wakeLock reference that
  // made every reacquire-guard below think a lock was still held while the screen had actually
  // gone dark.
  if(wakeLock&&wakeLock.released===true){
    wakeLock=null;
    jarvisRoadTestNoteLifecycle('WAKE_LOCK_RELEASED_UNEXPECTED',{via:'watchdog-health-check'});
  }
  if(!wakeLock)jarvisScheduleWakeReacquire('watchdog');
  jarvisWakeVideoEnsure();
},1000);
window.addEventListener('focus',()=>{jarvisSyncWakeLock();});
document.addEventListener('pointerdown',()=>{if(jarvisWakeWanted())jarvisSyncWakeLock();},{passive:true});

async function refreshDiagnostics(){
  setDiag('secureState',window.isSecureContext?'OK':'NG',window.isSecureContext?'ok':'bad');
  setDiag('apiState',navigator.geolocation?'利用可能':'利用不可',navigator.geolocation?'ok':'bad');
  if(!navigator.geolocation){setDiag('permState','確認不可','bad');diagMsg('このブラウザでは位置情報APIが利用できません。','bad');return}
  if(navigator.permissions&&navigator.permissions.query){
    try{
      const p=await navigator.permissions.query({name:'geolocation'});
      setDiag('permState',p.state,p.state==='granted'?'ok':p.state==='denied'?'bad':'warn');
      p.onchange=()=>setDiag('permState',p.state,p.state==='granted'?'ok':p.state==='denied'?'bad':'warn');
    }catch(e){setDiag('permState','Safariでは取得不可','warn')}
  }else setDiag('permState','Safariでは取得不可','warn')
}

function beginTimer(){
  if(running)return;
  running=true;startTime=Date.now();timerId=setInterval(updateStats,500);
  $('status').textContent='計測中';$('status').className='status ok';syncLandscapeStatus();
  $('startBtn').disabled=true;$('stopBtn').disabled=false;
  requestWakeLock()
}

function enterResumeGuard(){
  resumeGuardUntil=Date.now()+RESUME_GUARD_MS;goodSamplesAfterResume=0;lastPos=null;lastAcceptedSpeed=0;currentSpeedKmh=0;
  $('speed').textContent='0';
  if(running){$('status').textContent='GPS再同期中';$('status').className='status';syncLandscapeStatus();setDiag('gpsState','再同期中','warn');diagMsg('画面復帰後のGPSを再同期しています。異常速度は統計から除外します。','warn')}
  jarvisRoadTestNoteLifecycle('APP_RESUME',{});
  // v6.14.55: make the resume->reacquire link explicit here, in the one function every resume
  // path (visibilitychange, pageshow, first GPS fix) already calls, rather than depending on each
  // caller also remembering to call jarvisSyncWakeLock alongside it.
  if(typeof jarvisWakeWanted==='function'&&jarvisWakeWanted())jarvisScheduleWakeReacquire('app-resume');
}

function filteredSpeed(rawSpeed,pos,c){
  let sp=rawSpeed;if(sp===null||!isFinite(sp)||sp<0)sp=null;
  let dt=null,d=null;
  if(lastPos){
    dt=(pos.timestamp-lastPos.timestamp)/1000;d=haversine(lastPos.coords,c);
    if((sp===null||!isFinite(sp))&&dt>.5&&dt<10)sp=(d/dt)*3.6;
  }
  if(sp===null||!isFinite(sp))sp=0;
  if(sp>MAX_REASONABLE_SPEED)return{speed:0,accepted:false,reason:'速度上限超過',dt,d};
  if(c.accuracy>MAX_ACCEPTABLE_ACCURACY)return{speed:Math.min(sp,MAX_REASONABLE_SPEED),accepted:false,reason:'GPS精度低下',dt,d};
  if(Date.now()<resumeGuardUntil||goodSamplesAfterResume<2){goodSamplesAfterResume++;return{speed:sp<1.2?0:sp,accepted:false,reason:'再同期中',dt,d}}
  if(dt&&dt>0&&dt<5){
    const accel=Math.abs(sp-lastAcceptedSpeed)/dt;
    if(accel>MAX_ACCEL_KMH_PER_SEC)return{speed:lastAcceptedSpeed,accepted:false,reason:'急変除外',dt,d};
  }
  return{speed:sp<1.2?0:sp,accepted:true,reason:'',dt,d}
}

function updateNav(){
  if(!destination||currentLat===null||currentLon===null){
    $('navDistance').textContent='-- km'; setTextIf('landDistance','-- km'); setTextIf('landDistance','-- km');
    const msg=destination?'GPS待機中':'目的地を検索してください';
    setTextIf('navBearingText',msg); setTextIf('landBearing',msg);
    setTextIf('landName',destination?.name||'目的地未設定');
    jarvisSyncMaps();
    return;
  }
  const d=haversine({latitude:currentLat,longitude:currentLon},{latitude:destination.lat,longitude:destination.lon});
  const b=bearing(currentLat,currentLon,destination.lat,destination.lon);
  let hdg=null;
  if(typeof currentHeading==='number' && isFinite(currentHeading)) hdg=currentHeading;

  const distText=d<1000?`${Math.round(d)} m`:`${(d/1000).toFixed(d<10000?1:0)} km`;
  if(navMode==='ADVENTURE'||!routeData){$('navDistance').textContent=distText; setTextIf('landDistance',distText);setTextIf('routeEta',navMode==='ROUTE'?'ルート取得中…':'方角ナビ');}
  setTextIf('navName',destination.name||'目的地'); setTextIf('landName',destination.name||'目的地'); setTextIf('landName',destination.name||'目的地');
  if(hdg===null){
    const txt=`目的地方位 ${Math.round(b)}°（北基準）`;
    setTextIf('navBearingText',txt); setTextIf('landBearing',txt);
    setTextIf('headingState','進行方向 --°');
  }else{
    const rel=normalize180(b-hdg);
    const txt=`目的地方向 ${rel>15?'右':rel<-15?'左':'前方'} ${Math.abs(Math.round(rel))}°`;
    setTextIf('navBearingText',txt); setTextIf('landBearing',txt);
    setTextIf('headingState',`進行方向 ${Math.round(hdg)}°`);
  }
  jarvisSyncMaps();
}
// ===== v6.14.46 ROAD TEST telemetry (disabled by default; pure observer) =====
//
// A bounded, in-memory recorder for a real-iPhone/real-GPS/real-Google-Maps road test, per
// NEXT_BATCH_v6.14.46_REAL_ROAD_TEST.md. Completely inert unless `jarvisRoadTestStart()` is
// called (the road-test build's bootstrap does this; the normal app/manual-check/simulator
// builds never do, so this section changes nothing about their behavior). Every hook below is a
// pure READ of state that already exists elsewhere in this file — it never writes
// jarvisFreeMotion/jarvisMotion/navigation state, so it cannot become a new vehicle-position or
// route-progress authority (exercised directly by test/telemetry-tests.mjs).
let jarvisRoadTestEnabled=false;
let jarvisRoadTestSessionId=null;
let jarvisRoadTestSessionStartedAt=0;
let jarvisRoadTestBuffer=null;
let jarvisRoadTestMarkers=[];
let jarvisRoadTestErrors=[];
let jarvisRoadTestRejectedFixCount=0;
let jarvisRoadTestVoiceEventsSeen=0;
// Per-fix change-detection state, reset on every jarvisRoadTestStart()/jarvisRoadTestClearSession().
let jarvisRoadTestLastState=null;
let jarvisRoadTestLastGuidanceKind=null;
let jarvisRoadTestLastProjectionS=null;
let jarvisRoadTestLastDisplayPos=null;
let jarvisRoadTestLastDeviationEscape=false;
let jarvisRoadTestLastPendingRejoin=false;
let jarvisRoadTestLastRouteLastAt=0;

const JARVIS_ROAD_TEST_CAPACITY=4000; // ~60-110 min at a 1-2s real GPS update rate, with margin
const JARVIS_ROAD_TEST_MARKER_CAPACITY=300;
const JARVIS_ROAD_TEST_ERROR_CAPACITY=200;
// road-test/build-artifact.mjs injects window.__JARVIS_ROAD_TEST_BUILD_ID (a per-build timestamp
// stamp) as an inline <script> before this file, so every fresh build/publish is distinguishable
// in the exported JSON and the on-screen build tag — this is what "unique BUILD-ID" (§6) means
// concretely, without needing a separate versioned JS filename for a file that is inlined into
// one self-contained HTML document rather than fetched separately (see road-test/README.md).
const JARVIS_ROAD_TEST_BUILD_ID=(typeof window!=='undefined'&&window.__JARVIS_ROAD_TEST_BUILD_ID)||'v6.14.57-ROADTEST-dev';

// Fixed-capacity ring buffer: O(1) push regardless of how long the session runs, unlike an
// unbounded array with periodic .shift() calls (O(n) each time, and still technically unbounded
// until the shift happens). toArray() re-linearizes to chronological order for export/tests only.
function jarvisRoadTestCreateRingBuffer(capacity){
  return{
    capacity,items:new Array(capacity),writeIndex:0,count:0,
    push(item){this.items[this.writeIndex]=item;this.writeIndex=(this.writeIndex+1)%this.capacity;this.count=Math.min(this.capacity,this.count+1);},
    toArray(){
      if(this.count<this.capacity)return this.items.slice(0,this.count);
      return this.items.slice(this.writeIndex).concat(this.items.slice(0,this.writeIndex));
    }
  };
}

function jarvisRoadTestNewSessionId(){return `rt-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;}
function jarvisRoadTestClearSession(){
  jarvisRoadTestSessionId=jarvisRoadTestNewSessionId();
  jarvisRoadTestSessionStartedAt=Date.now();
  jarvisRoadTestBuffer=jarvisRoadTestCreateRingBuffer(JARVIS_ROAD_TEST_CAPACITY);
  jarvisRoadTestMarkers=[];
  jarvisRoadTestErrors=[];
  jarvisRoadTestRejectedFixCount=0;
  jarvisRoadTestVoiceEventsSeen=(window.__jarvisVoiceEvents||[]).length;
  jarvisRoadTestLastState=null;
  jarvisRoadTestLastGuidanceKind=null;
  jarvisRoadTestLastProjectionS=null;
  jarvisRoadTestLastDisplayPos=null;
  jarvisRoadTestLastDeviationEscape=false;
  jarvisRoadTestLastPendingRejoin=false;
  jarvisRoadTestLastRouteLastAt=typeof routeLastAt!=='undefined'?routeLastAt:0;
}
function jarvisRoadTestStart(){jarvisRoadTestEnabled=true;jarvisRoadTestClearSession();}
function jarvisRoadTestStop(){jarvisRoadTestEnabled=false;}
function jarvisRoadTestLogError(context,err){
  try{
    jarvisRoadTestErrors.push({t:Date.now(),context,message:String(err&&err.message||err||'')});
    if(jarvisRoadTestErrors.length>JARVIS_ROAD_TEST_ERROR_CAPACITY)jarvisRoadTestErrors.shift();
  }catch(e){}
}
function jarvisRoadTestMarker(kind,detail){
  try{
    const m={t:Date.now(),kind,detail:detail||null};
    jarvisRoadTestMarkers.push(m);
    if(jarvisRoadTestMarkers.length>JARVIS_ROAD_TEST_MARKER_CAPACITY)jarvisRoadTestMarkers.shift();
    return m;
  }catch(e){jarvisRoadTestLogError('marker',e);return null;}
}
// Called from enterResumeGuard() (app resume from hidden/background) and the wake-lock request/
// release functions — events that can happen between GPS fixes, not just at one.
function jarvisRoadTestNoteLifecycle(kind,detail){
  if(!jarvisRoadTestEnabled)return;
  jarvisRoadTestMarker(kind,detail);
}
// Called from onPosition()'s f.accepted===false branch — counts fixes rejected for accuracy/
// resume-guard/reasonable-speed reasons, per the export summary metrics spec.
function jarvisRoadTestNoteRejectedFix(reason){
  if(!jarvisRoadTestEnabled)return;
  jarvisRoadTestRejectedFixCount++;
}

// One compact event per accepted GPS/navigation update (called at the end of onPosition()).
// High-signal markers (§3 of the spec) are detected here, against the PREVIOUS fix's recorded
// state, and appended to jarvisRoadTestMarkers — never by changing any routing/guidance decision.
function jarvisRoadTestRecordFix(c,sp){
  if(!jarvisRoadTestEnabled||!jarvisRoadTestBuffer)return;
  try{
    const vp=(typeof jarvisGetVehiclePose==='function')?jarvisGetVehiclePose():null;
    const guidance=(()=>{try{return jarvisCurrentGuidanceEvent();}catch(e){return null;}})();
    const nextTurn=(()=>{try{return jarvisNextTurnInfo();}catch(e){return null;}})();
    const projectionS=(typeof jarvisMotionDiag!=='undefined')?jarvisMotionDiag.projectionS:null;
    const candidateS=(typeof jarvisMotionDiag!=='undefined')?jarvisMotionDiag.candidateS:null;
    const crossTrack=(typeof jarvisMotionDiag!=='undefined'&&Number.isFinite(jarvisMotionDiag.projectionDistance))?jarvisMotionDiag.projectionDistance:((typeof jarvisRerouteDiag!=='undefined')?jarvisRerouteDiag.rerouteDistance:null);
    const navState=typeof jarvisNavTrackingState!=='undefined'?jarvisNavTrackingState:null;

    const allVoice=window.__jarvisVoiceEvents||[];
    const newVoice=allVoice.slice(jarvisRoadTestVoiceEventsSeen).map(v=>({key:v.key,level:v.level,accepted:v.accepted,reason:v.reason}));
    jarvisRoadTestVoiceEventsSeen=allVoice.length;

    const event={
      t:Date.now(),
      gps:{lat:c.latitude,lng:c.longitude,accuracy:Number(c.accuracy)},
      speed:{raw:Number.isFinite(sp)?sp:null,filtered:typeof currentSpeedKmh!=='undefined'?currentSpeedKmh:null},
      heading:{value:typeof currentHeading==='number'?currentHeading:null,source:typeof headingSource!=='undefined'?headingSource:null},
      vehiclePose:vp?{lat:vp.lat,lng:vp.lng,heading:vp.heading,speedMps:vp.speedMps,source:vp.source,confidence:vp.confidence}:null,
      projectionS,candidateS,crossTrackDistance:crossTrack,
      navState,
      deviationEvidence:typeof jarvisDeviationEvidence!=='undefined'?jarvisDeviationEvidence:null,
      autoRerouteOffRouteFixes:typeof autoRerouteOffRouteFixes!=='undefined'?autoRerouteOffRouteFixes:null,
      deviationEscape:typeof jarvisDeviationEscape!=='undefined'?jarvisDeviationEscape:null,
      visualGpsPriority:typeof jarvisVisualGpsPriority!=='undefined'?jarvisVisualGpsPriority:null,
      pendingRouteRejoin:typeof jarvisPendingRouteRejoin!=='undefined'?jarvisPendingRouteRejoin:null,
      pendingRouteRejoinFixes:typeof jarvisPendingRouteRejoinFixes!=='undefined'?jarvisPendingRouteRejoinFixes:null,
      guidance:guidance?{kind:guidance.kind,maneuver:guidance.maneuver,distance:guidance.distance,turnDeg:guidance.turnDeg}:null,
      routeRequestSeq:typeof routeRequestSeq!=='undefined'?routeRequestSeq:null,
      routeIntegrityStatus:(typeof jarvisRouteIntegrity!=='undefined')?jarvisRouteIntegrity.status:null,
      followMode:typeof navMapFollow!=='undefined'?navMapFollow:null,
      cameraMode:(typeof jarvisRerouteCamera!=='undefined')?jarvisRerouteCamera.mode:null,
      voiceAttempts:newVoice.length?newVoice:undefined
    };
    jarvisRoadTestBuffer.push(event);

    // ---- high-signal markers (§3): compared against the previous fix only, never changing any
    // routing/guidance decision itself. ----
    if(jarvisRoadTestLastState!=='OFF_ROUTE'&&navState==='OFF_ROUTE')jarvisRoadTestMarker('OFF_ROUTE_BEGIN',{lat:c.latitude,lng:c.longitude});
    if(jarvisRoadTestLastState!=='REROUTING'&&navState==='REROUTING')jarvisRoadTestMarker('REROUTING_BEGIN',{lat:c.latitude,lng:c.longitude});
    if(jarvisRoadTestLastState==='REROUTING'&&navState!=='REROUTING')jarvisRoadTestMarker('REROUTING_END',{navState});
    if(jarvisRoadTestLastState!=='ARRIVED'&&navState==='ARRIVED')jarvisRoadTestMarker('ARRIVED',{lat:c.latitude,lng:c.longitude});

    const routeLastAtNow=typeof routeLastAt!=='undefined'?routeLastAt:0;
    if(routeLastAtNow!==jarvisRoadTestLastRouteLastAt&&(jarvisRoadTestLastState==='OFF_ROUTE'||jarvisRoadTestLastState==='REROUTING'))
      jarvisRoadTestMarker('REROUTE_ACCEPTED',{routeRequestSeq:event.routeRequestSeq});
    jarvisRoadTestLastRouteLastAt=routeLastAtNow;

    const pendingRejoinNow=!!event.pendingRouteRejoin;
    if(!jarvisRoadTestLastPendingRejoin&&pendingRejoinNow)jarvisRoadTestMarker('REJOIN_BEGIN',{});
    if(jarvisRoadTestLastDeviationEscape&&!event.deviationEscape)jarvisRoadTestMarker('REJOIN_END',{});
    jarvisRoadTestLastPendingRejoin=pendingRejoinNow;
    jarvisRoadTestLastDeviationEscape=!!event.deviationEscape;

    if(vp&&jarvisRoadTestLastDisplayPos){
      const stepM=haversine({latitude:jarvisRoadTestLastDisplayPos.lat,longitude:jarvisRoadTestLastDisplayPos.lng},{latitude:vp.lat,longitude:vp.lng});
      if(stepM>25)jarvisRoadTestMarker('VEHICLE_POSE_LARGE_STEP',{stepM:Math.round(stepM*10)/10,speedKmh:event.speed.filtered});
    }
    if(vp)jarvisRoadTestLastDisplayPos={lat:vp.lat,lng:vp.lng};

    if(Number.isFinite(projectionS)&&Number.isFinite(jarvisRoadTestLastProjectionS)){
      const deltaS=projectionS-jarvisRoadTestLastProjectionS;
      const speedMps=Math.max(0,(Number(event.speed.filtered)||0)/3.6);
      const plausibleForward=Math.max(80,speedMps*3+50);
      if(deltaS<-30)jarvisRoadTestMarker('ROUTE_PROJECTION_BACKWARD_JUMP',{deltaS:Math.round(deltaS)});
      else if(deltaS>plausibleForward)jarvisRoadTestMarker('ROUTE_PROJECTION_FORWARD_JUMP',{deltaS:Math.round(deltaS),plausibleForward:Math.round(plausibleForward)});
    }
    jarvisRoadTestLastProjectionS=Number.isFinite(projectionS)?projectionS:jarvisRoadTestLastProjectionS;

    const guidanceKindNow=guidance?guidance.kind:null;
    if(guidanceKindNow!==jarvisRoadTestLastGuidanceKind&&guidanceKindNow&&['EXIT','DIVERGE','MERGE'].includes(guidanceKindNow))
      jarvisRoadTestMarker('MANEUVER_CLASS_CHANGE',{kind:guidanceKindNow,maneuver:guidance?.maneuver||null});
    jarvisRoadTestLastGuidanceKind=guidanceKindNow;

    if(nextTurn&&Number.isFinite(nextTurn.distance)&&nextTurn.distance<=100&&nextTurn.distance>=0&&!guidance)
      jarvisRoadTestMarker('GUIDANCE_EXPECTED_BUT_MISSING',{turnDistance:Math.round(nextTurn.distance)});
    if(guidance&&guidance.kind==='TURN'&&Number.isFinite(guidance.turnDeg)&&guidance.turnDeg<8)
      jarvisRoadTestMarker('GUIDANCE_TURN_BUT_STRAIGHT_GEOMETRY',{turnDeg:guidance.turnDeg,distance:guidance.distance});

    jarvisRoadTestLastState=navState;
  }catch(e){jarvisRoadTestLogError('recordFix',e);}
}

// Same duplicate/order-error algorithm as the simulator's analyzeVoice() in
// navigation-simulator-core.js, duplicated here (rather than shared) because this file has no
// build-time dependency on that simulator-only module and must work standalone in the real app.
function jarvisRoadTestVoiceCounts(){
  const events=(window.__jarvisVoiceEvents||[]).filter(e=>e.sessionId===jarvisVoiceSessionId);
  const accepted=events.filter(e=>e.accepted);
  const byBase={};
  for(const e of accepted){
    if(!e.key)continue;
    const parts=String(e.key).split(':');
    const base=parts.slice(0,2).join(':'),level=parts[2]||e.level||'';
    (byBase[base]=byBase[base]||[]).push({at:e.at,level});
  }
  let voiceDuplicateCount=0,voiceOrderErrors=0;
  for(const base of Object.keys(byBase)){
    const seq=byBase[base].sort((a,b)=>a.at-b.at);
    const byLevel={};
    for(const s of seq)(byLevel[s.level]=byLevel[s.level]||[]).push(s.at);
    for(const level of Object.keys(byLevel))if(byLevel[level].length>1)voiceDuplicateCount+=byLevel[level].length-1;
    const approach=byLevel.approach?.[0],near=byLevel.near?.[0];
    if(approach!==undefined&&near!==undefined&&near<approach)voiceOrderErrors++;
  }
  return{voiceDuplicateCount,voiceOrderErrors};
}
function jarvisRoadTestSummary(events){
  events=events||(jarvisRoadTestBuffer?jarvisRoadTestBuffer.toArray():[]);
  let maxVehiclePoseStep=0,offRouteFixes=0,rerouteBeginCount=0,rejoinCount=0,maneuverEvents=0;
  let prev=null;
  for(const e of events){
    if(e.navState==='OFF_ROUTE'||e.navState==='REROUTING')offRouteFixes++;
    if(prev&&prev.vehiclePose&&e.vehiclePose){
      const d=haversine({latitude:prev.vehiclePose.lat,longitude:prev.vehiclePose.lng},{latitude:e.vehiclePose.lat,longitude:e.vehiclePose.lng});
      maxVehiclePoseStep=Math.max(maxVehiclePoseStep,d);
    }
    if(e.guidance)maneuverEvents++;
    prev=e;
  }
  for(const m of jarvisRoadTestMarkers){
    if(m.kind==='REROUTING_BEGIN')rerouteBeginCount++;
    if(m.kind==='REJOIN_BEGIN')rejoinCount++;
  }
  const voice=jarvisRoadTestVoiceCounts();
  return{
    // "maximum displayed-vehicle single-step distance if separately observable": VehiclePose IS
    // the displayed vehicle position (see README's VehiclePose section) in this build, so there
    // is no second, independently-observable value — both fields report the same number rather
    // than fabricating a distinct one.
    maxVehiclePoseStepM:Math.round(maxVehiclePoseStep*10)/10,
    maxDisplayStepM:Math.round(maxVehiclePoseStep*10)/10,
    offRouteFixCount:offRouteFixes,
    reroutingBeginCount:rerouteBeginCount,
    routeRequestCount:events.length?Math.max(...events.map(e=>Number(e.routeRequestSeq)||0)):0,
    rejoinCount,
    maneuverEventCount:maneuverEvents,
    voiceDuplicateCount:voice.voiceDuplicateCount,
    voiceOrderErrors:voice.voiceOrderErrors,
    rejectedFixCount:jarvisRoadTestRejectedFixCount,
    routeIntegrityWarnCount:events.filter(e=>e.routeIntegrityStatus==='WARN').length,
    routeIntegrityBlockCount:events.filter(e=>['CORRUPT','REVERSED','NO_ROUTE','INVALID_POINTS'].includes(e.routeIntegrityStatus)).length
  };
}

function jarvisRoadTestExport(){
  const events=jarvisRoadTestBuffer?jarvisRoadTestBuffer.toArray():[];
  const route=(typeof routeCandidates!=='undefined'?(routeCandidates[selectedRouteIndex]||routeData):null);
  return{
    buildId:JARVIS_ROAD_TEST_BUILD_ID,
    exportedAt:new Date().toISOString(),
    userAgent:typeof navigator!=='undefined'?navigator.userAgent:null,
    session:{id:jarvisRoadTestSessionId,startedAt:jarvisRoadTestSessionStartedAt?new Date(jarvisRoadTestSessionStartedAt).toISOString():null,endedAt:new Date().toISOString()},
    destination:(typeof destination!=='undefined'&&destination)?{lat:destination.lat,lon:destination.lon,name:destination.name||null}:null,
    routeSummary:route?{distanceMeters:route.distanceMeters,durationMillis:route.durationMillis,pathLength:Array.isArray(route.path)?route.path.length:0}:null,
    routeIntegrity:(typeof jarvisRouteIntegrity!=='undefined')?{...jarvisRouteIntegrity}:null,
    // v6.14.47: Maps/geolocation hosting diagnostics — mapsDetail/mapsOrigin are fixed,
    // key-free explanation text (see jarvisSetHostDiag), never the API key itself.
    hostDiag:(typeof jarvisHostDiag!=='undefined')?{...jarvisHostDiag}:null,
    events,
    markers:jarvisRoadTestMarkers.slice(),
    voiceEvents:(window.__jarvisVoiceEvents||[]).slice(),
    errors:jarvisRoadTestErrors.slice(),
    summary:jarvisRoadTestSummary(events)
  };
}
// Global uncaught-error capture: only *records* into the road-test error log when road-test mode
// is on (the check is inside the handler, so registering this listener unconditionally costs
// nothing when road test mode is off — it just never has anything to do). Catches exceptions
// jarvisRoadTestRecordFix's own try/catch cannot see (e.g. inside jarvisMotionAcceptFix/
// jarvisAutoRerouteUpdate, which run before jarvisRoadTestRecordFix in onPosition and are not
// themselves wrapped in try/catch in normal production code).
window.addEventListener('error',(e)=>{if(jarvisRoadTestEnabled)jarvisRoadTestLogError('window.onerror',e?.error||e?.message||e);});

// v6.14.55: stable vehicle-ball color. The marker's own base color (app-v6.14.44.css's
// ".earth-orb.blue-orb") is now fixed and no longer varies with navigation state — a color that
// changes on every GPS-accuracy blip or brief OFF_ROUTE read as visual noise on a real ride.
// Degraded states are represented by an outer ring around the same base color instead
// (".ball-warning"), toggled here from the single authoritative jarvisNavTrackingState.
function jarvisUpdateVehicleBallState(){
  const div=navSquidOverlay?.div;if(!div)return;
  const warn=navSessionStarted&&jarvisNavTrackingState!=='TRACKING';
  div.classList.toggle('ball-warning',warn);
}

function onPosition(pos){
  const c=pos.coords;
  currentLat=c.latitude;currentLon=c.longitude; jarvisUpdateWeather();
  // 進行↑は端末コンパスを使わず、GPSの移動軌跡から進行方位を自前計算。
  // Safari/iPhoneで coords.heading が null でも動く。停止時は最後の有効方位を保持する。
  const nowFix={latitude:c.latitude,longitude:c.longitude};
  let derivedHeading=null;
  if(courseLastFix){
    const moved=haversine(courseLastFix,nowFix);
    const dt=(pos.timestamp-courseLastAt)/1000;
    // v6.14.18: a longer baseline prevents intersection GPS jitter from looking like
    // repeated mini-turns. Update the anchor only after a meaningful displacement.
    const minCourseMove=Math.max(5.0,Math.min(9.0,(Number(c.accuracy)||20)*.28));
    if(c.accuracy<=MAX_ACCEPTABLE_ACCURACY && dt>0.55 && dt<12 && moved>=minCourseMove){
      derivedHeading=bearing(courseLastFix.latitude,courseLastFix.longitude,c.latitude,c.longitude);
    }
  }
  if(derivedHeading!==null){
    const delta=Number.isFinite(currentHeading)?Math.abs(jarvisNorm180(derivedHeading-currentHeading)):0;
    const gain=delta>35?.24:delta>18?.18:.12;
    currentHeading=smoothHeading(currentHeading,derivedHeading,gain);
    headingSource='COURSE';
    courseLastFix=nowFix; courseLastAt=pos.timestamp;
  }else if(typeof c.heading==='number' && isFinite(c.heading) && (c.speed===null || c.speed>1.0)){
    currentHeading=smoothHeading(currentHeading,(c.heading+360)%360,0.16);
    headingSource='GPS';
    if(!courseLastFix){courseLastFix=nowFix;courseLastAt=pos.timestamp;}
  }else if(!courseLastFix){
    courseLastFix=nowFix; courseLastAt=pos.timestamp;
  }

  setDiag('gpsState','受信中','ok');
  $('accuracy').textContent='GPS精度 ±'+Math.round(c.accuracy)+' m';

  const raw=(typeof c.speed==='number'&&c.speed>=0)?c.speed*3.6:null;
  const f=filteredSpeed(raw,pos,c);let sp=f.speed;

  if(f.accepted){
    if(lastPos&&f.dt&&f.dt>0&&f.dt<15&&f.d!==null){
      const plausible=f.d<Math.max(35,(sp/3.6)*f.dt*2.8+12);
      if(running&&sp>=2&&f.d>=1&&plausible)totalDistanceM+=f.d;
    }
    lastAcceptedSpeed=sp;currentSpeedKmh=sp;if(running)maxSpeedKmh=Math.max(maxSpeedKmh,sp);
    diagMsg(`GPS受信成功：精度 ±${Math.round(c.accuracy)} m`,'ok');
  }else{
    currentSpeedKmh=sp;if(f.reason)diagMsg(`GPS受信中：${f.reason}（異常値は記録しません）`,'warn');
    jarvisRoadTestNoteRejectedFix(f.reason);
  }

  $('speed').textContent=Math.round(sp); if($('navSpeed')) $('navSpeed').textContent=Math.round(sp); setTextIf('landSpeed',Math.round(sp)); $('maxSpeed').textContent=Math.round(maxSpeedKmh);
  jarvisFreeAcceptFix(c.latitude,c.longitude,sp,c.accuracy);
  jarvisMotionAcceptFix(c.latitude,c.longitude,sp,c.accuracy);
  updateStats();updateNav();
  // v6.14.7: START中は横ずれ＋進行方向＋継続fixで逸脱判定。
  // Uターン案内を拒否して走り続けた場合は、進行方向を尊重して再リルートする。
  if(Number.isFinite(currentHeading)&&sp>=5)jarvisLastMovingHeading=currentHeading;
  jarvisUpdateViaVisited(c.latitude,c.longitude);
  const arrivedNow=jarvisArrivalUpdate();
  if(!arrivedNow){
    jarvisAutoRerouteUpdate(c,sp);
    jarvisVoiceGuideUpdate();
  }
  lastPos={coords:{latitude:c.latitude,longitude:c.longitude},timestamp:pos.timestamp};
  jarvisUpdateVehicleBallState();
  jarvisRoadTestRecordFix(c,sp);
}

function onError(err){
  starting=false;
  const map={1:'位置情報が拒否されました',2:'現在地を取得できません',3:'GPS取得がタイムアウトしました'};
  const msg=map[err.code]||`GPSエラー (${err.code})`;
  if(err.code===1)jarvisSetGeoDiag('GEOLOCATION_PERMISSION_DENIED');
  setDiag('gpsState','エラー','bad');diagMsg(`${msg}${err.message?`：${err.message}`:''}`,'bad');
  $('status').textContent=msg;$('status').className='status bad';syncLandscapeStatus();$('startBtn').disabled=false;$('stopBtn').disabled=true;refreshDiagnostics();
}

function startWatch(){
  if(watchId!==null)navigator.geolocation.clearWatch(watchId);
  watchId=navigator.geolocation.watchPosition(onPosition,onError,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  jarvisLocationTrackingActive=true;
}

function startGPS(){
  if(starting||running)return;
  refreshDiagnostics();
  if(!window.isSecureContext){$('status').textContent='HTTPSが必要';$('status').className='status bad';syncLandscapeStatus();diagMsg('HTTPSではないためGPSを利用できません。','bad');return}
  if(!navigator.geolocation){jarvisSetGeoDiag('GEOLOCATION_UNAVAILABLE');$('status').textContent='GPS非対応';$('status').className='status bad';syncLandscapeStatus();return}
  starting=true;$('startBtn').disabled=true;setDiag('gpsState','取得要求中','warn');diagMsg('iPhoneへ位置情報を要求しています…','warn');$('status').textContent='GPS待機中';$('status').className='status';syncLandscapeStatus();
  navigator.geolocation.getCurrentPosition(pos=>{starting=false;jarvisSetGeoDiag('OK');enterResumeGuard();onPosition(pos);beginTimer();startWatch()},onError,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}

async function stopGPS(){
  if(running){elapsedBefore+=Date.now()-startTime;startTime=null;running=false;clearInterval(timerId);timerId=null;updateStats()}
  jarvisStopLocationTrackingIfIdle();
  $('status').textContent=jarvisIsNavVisible()?'現在地追跡中':'一時停止';$('status').className='status';syncLandscapeStatus();setDiag('gpsState',watchId!==null?'追跡中':'停止中',watchId!==null?'ok':'');$('startBtn').disabled=false;$('stopBtn').disabled=true;await jarvisSyncWakeLock();
}

async function resetTrip(){
  if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}
  running=false;starting=false;if(timerId)clearInterval(timerId);timerId=null;
  startTime=null;elapsedBefore=0;lastPos=null;totalDistanceM=0;maxSpeedKmh=0;currentSpeedKmh=0;lastAcceptedSpeed=0;resumeGuardUntil=0;goodSamplesAfterResume=0;
  currentHeading=null;headingSource='--';courseLastFix=null;courseLastAt=0;jarvisMotionReset();
  $('speed').textContent='0'; if($('navSpeed')) $('navSpeed').textContent='0'; setTextIf('landSpeed','0'); $('maxSpeed').textContent='0';$('avgSpeed').textContent='0';$('distance').textContent='0.00';$('elapsed').textContent='00:00';$('accuracy').textContent='GPS精度 -- m';
  $('diff').textContent='--';$('errorRate').textContent='--';$('status').textContent='待機中';$('status').className='status';syncLandscapeStatus();$('startBtn').disabled=false;$('stopBtn').disabled=true;
  setDiag('gpsState','未開始','');diagMsg('STARTを押すと、GPS取得を試します。');await jarvisSyncWakeLock();refreshDiagnostics();updateNav();
}

function calcError(){
  const meter=parseFloat($('meterInput').value),gps=currentSpeedKmh;
  if(!isFinite(meter)||meter<=0){$('diff').textContent='入力して';$('errorRate').textContent='--';return}
  const diff=meter-gps,rate=gps>0?(diff/gps)*100:NaN;
  $('diff').textContent=(diff>=0?'+':'')+diff.toFixed(1)+' km/h';
  $('errorRate').textContent=isFinite(rate)?((rate>=0?'+':'')+rate.toFixed(1)+'%'):'--';
}



function jarvisUpdateNavModeButtons(){
  $('adventureModeBtn')?.classList.toggle('active',navMode==='ADVENTURE');
  $('routeModeBtn')?.classList.toggle('active',navMode==='ROUTE');
  setTextIf('routeEta',navMode==='ADVENTURE'?'方角ナビ':(routeData?jarvisRouteEtaText(routeData):'ルート待機'));
  $('routeChoicePanel')?.classList.add('hidden');
  jarvisUpdateMapStartButton();
}
function jarvisSetNavMode(mode){
  navMode=mode==='ROUTE'?'ROUTE':'ADVENTURE';
  localStorage.setItem('jarvisNavMode',navMode);jarvisUpdateNavModeButtons();jarvisSyncTrafficLayers();
  if(navMode==='ROUTE') jarvisComputeRoute(true); else {jarvisHideRouteLines();updateNav();jarvisSyncMaps(true);}
}
function jarvisHideRouteLines(){
  jarvisClearRouteLabels();
  navRouteLine?.setMap(null);landRouteLine?.setMap(null);
  navAltRouteLines.forEach(x=>x?.setMap(null)); navAltRouteLines=[];
}
function jarvisClearRoute(){
  routeData=null;routeCandidates=[];selectedRouteIndex=0;routeLastOrigin=null;routeLastAt=0;routePreviewActive=false;navSessionStarted=false;jarvisAutoDeviationCount=0;jarvisOriginalRoutePath=[];
  jarvisClearOriginalRouteSnapshot();
  jarvisClearRouteLabels();jarvisHideRouteLines();navRouteLine=landRouteLine=null;
  setTextIf('routeEta',navMode==='ROUTE'?'ルート待機':'方角ナビ');
  const panel=$('routeChoicePanel'); if(panel){panel.innerHTML='';panel.classList.add('hidden');}
  jarvisUpdateMapStartButton();
}
function jarvisRouteEtaText(r){
  if(!r)return '-- 分 / --:--';
  const min=Math.max(1,Math.round(r.durationMillis/60000));
  const eta=new Date(Date.now()+r.durationMillis).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false});
  return `${min}分 / ${eta}着`;
}
function jarvisRouteDistanceText(r){
  if(!r)return '--';
  return r.distanceMeters<1000?`${Math.round(r.distanceMeters)} m`:`${(r.distanceMeters/1000).toFixed(r.distanceMeters<10000?1:0)} km`;
}
function jarvisRenderRouteChoices(){
  // v3.9: 候補は地図上の色付きルート＋小型ラベルで直接選ぶ。STARTボタンも選択色と同期。
  const panel=$('routeChoicePanel'); if(panel){panel.innerHTML='';panel.classList.add('hidden');}
}
function jarvisSelectRoute(i){
  if(!routeCandidates[i])return;
  selectedRouteIndex=i;routeData=routeCandidates[i];jarvisRenderRouteChoices();jarvisRenderRoute();
  const km=jarvisRouteDistanceText(routeData);$('navDistance').textContent=km;setTextIf('landDistance',km);setTextIf('routeEta',jarvisRouteEtaText(routeData));
  jarvisSetStatus(`ルート${i+1}を選択：${km} / ${jarvisRouteEtaText(routeData)}`,'ok');
}
function jarvisClearRouteLabels(){
  navRouteLabels.forEach(o=>{try{o.setMap(null)}catch(e){}}); navRouteLabels=[];
  window.jarvisRouteLabelPoints=[];
}
function jarvisComputeRouteLabelPoints(){
  const routes=routeCandidates.filter(r=>r?.path?.length);
  if(!routes.length){window.jarvisRouteLabelPoints=[];return [];}
  const ll=(p)=>({latitude:typeof p?.lat==='function'?p.lat():Number(p?.lat),longitude:typeof p?.lng==='function'?p.lng():Number(p?.lng)});
  const meters=(a,b)=>haversine(ll(a),ll(b));
  const candidates=routes.map((route,ri)=>{
    const path=route.path; const out=[];
    const start=Math.max(1,Math.floor(path.length*0.12));
    const end=Math.min(path.length-2,Math.ceil(path.length*0.88));
    const count=18;
    for(let n=0;n<count;n++){
      const idx=Math.max(start,Math.min(end,Math.round(start+(end-start)*(n/(count-1)))));
      const pt=path[idx];
      let exclusive=99999;
      routes.forEach((other,oj)=>{
        if(oj===ri)return;
        const op=other.path; const os=Math.max(1,Math.floor(op.length/36)); let near=99999;
        for(let k=0;k<op.length;k+=os) near=Math.min(near,meters(pt,op[k]));
        exclusive=Math.min(exclusive,near);
      });
      if(routes.length===1)exclusive=0;
      const edge=Math.min(idx-start,end-idx)/Math.max(1,end-start);
      out.push({pt,exclusive,edge});
    }
    return out;
  });
  let best=null,bestScore=-Infinity;
  const scoreSet=(set)=>{
    let minPair=99999,sumPair=0,pairs=0;
    for(let a=0;a<set.length;a++)for(let b=a+1;b<set.length;b++){
      const d=meters(set[a].pt,set[b].pt);minPair=Math.min(minPair,d);sumPair+=d;pairs++;
    }
    if(!pairs)minPair=0;
    const avgPair=pairs?sumPair/pairs:0;
    const exclusive=set.reduce((t,x)=>t+Math.min(x.exclusive,1800),0);
    const edge=set.reduce((t,x)=>t+x.edge,0);
    let penalty=0;
    if(minPair<900)penalty+=(900-minPair)*7;
    if(minPair<500)penalty+=(500-minPair)*12;
    return minPair*6 + avgPair*1.7 + exclusive*1.6 + edge*250 - penalty;
  };
  if(candidates.length===1){best=[candidates[0][Math.floor(candidates[0].length/2)]];}
  else if(candidates.length===2){
    for(const a of candidates[0])for(const b of candidates[1]){const set=[a,b],sc=scoreSet(set);if(sc>bestScore){bestScore=sc;best=set;}}
  }else{
    for(const a of candidates[0])for(const b of candidates[1])for(const c of candidates[2]){const set=[a,b,c],sc=scoreSet(set);if(sc>bestScore){bestScore=sc;best=set;}}
  }
  const points=(best||[]).map(x=>x.pt);
  window.jarvisRouteLabelPoints=points; return points;
}
function jarvisRouteLabelPoint(route,i){
  const points=window.jarvisRouteLabelPoints?.length===routeCandidates.length?window.jarvisRouteLabelPoints:jarvisComputeRouteLabelPoints();
  return points?.[i] || route?.path?.[Math.floor((route.path.length-1)*(0.28+i*0.22))] || null;
}
function jarvisCreateRouteLabel(map,route,i){
  if(!map||!route?.path?.length)return null;
  const overlay=new google.maps.OverlayView();
  overlay.position=jarvisRouteLabelPoint(route,i); overlay.div=null;
  overlay.onAdd=function(){
    const d=document.createElement('button');d.type='button';d.className=`route-map-label r${i}${i===selectedRouteIndex?' selected':''}`;
    d.textContent=`${Math.max(1,Math.round(route.durationMillis/60000))}分 · ${jarvisRouteDistanceText(route)}`;
    d.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();jarvisSelectRoute(i)});
    this.div=d;this.getPanes().overlayMouseTarget.appendChild(d);
  };
  overlay.draw=function(){if(!this.div||!this.position)return;const pt=this.getProjection().fromLatLngToDivPixel(this.position);if(!pt)return;this.div.style.left=pt.x+'px';this.div.style.top=pt.y+'px';};
  overlay.onRemove=function(){this.div?.remove();this.div=null}; overlay.setMap(map); return overlay;
}
function jarvisFitRoutePreview(){
  if(!navGoogleMap||!routeCandidates.length||navSessionStarted)return;
  routePreviewActive=true;
  const bounds=new google.maps.LatLngBounds();
  if(typeof currentLat==='number'&&typeof currentLon==='number')bounds.extend({lat:currentLat,lng:currentLon});
  if(destination)bounds.extend({lat:destination.lat,lng:destination.lon});
  routeCandidates.forEach(r=>r.path?.forEach(pt=>bounds.extend(pt)));
  navMapFollow=false;navMapUserMoved=true;
  requestAnimationFrame(()=>{google.maps.event.trigger(navGoogleMap,'resize');navGoogleMap.fitBounds(bounds,{top:120,right:44,bottom:150,left:44});jarvisUpdateRecenterButton();});
}
function jarvisScrollToMap(){
  const shell=document.querySelector('#navPanel .nav-map-shell');
  if(!shell)return;
  setTimeout(()=>shell.scrollIntoView({behavior:'smooth',block:'start'}),40);
}
function jarvisRouteButtonColor(i){
  return ['#0b63ce','#72d2ff','#8fe6b0'][i]||'#0b63ce';
}
function jarvisCleanInstruction(text){
  if(!text)return '';
  const d=document.createElement('div');d.innerHTML=String(text);return (d.textContent||d.innerText||'').replace(/\s+/g,' ').trim();
}
function jarvisVoiceManeuverText(m){
  const key=String(m||'').toUpperCase();
  const map={
    TURN_LEFT:'左折です',TURN_RIGHT:'右折です',TURN_SLIGHT_LEFT:'斜め左方向です',TURN_SLIGHT_RIGHT:'斜め右方向です',
    TURN_SHARP_LEFT:'大きく左折です',TURN_SHARP_RIGHT:'大きく右折です',STRAIGHT:'直進です',CONTINUE:'そのまま直進です',
    U_TURN_LEFT:'左方向へUターンです',U_TURN_RIGHT:'右方向へUターンです',RAMP_LEFT:'左のランプへ進みます',RAMP_RIGHT:'右のランプへ進みます',OFF_RAMP_LEFT:'左の出口です',OFF_RAMP_RIGHT:'右の出口です',EXIT_LEFT:'左の出口です',EXIT_RIGHT:'右の出口です',
    FORK_LEFT:'左方向へ進みます',FORK_RIGHT:'右方向へ進みます',KEEP_LEFT:'左方向を維持します',KEEP_RIGHT:'右方向を維持します',MERGE:'合流します',ROUNDABOUT_LEFT:'ロータリーに入ります',ROUNDABOUT_RIGHT:'ロータリーに入ります'
  };
  return map[key]||'';
}
function jarvisVoiceStepText(step){
  const dir=jarvisTurnDir(step);
  if(dir==='RIGHT')return '右折です';
  if(dir==='LEFT')return '左折です';
  return '';
}
function jarvisVoiceLatLng(v){
  if(!v)return null;
  const lat=typeof v.lat==='function'?v.lat():Number(v.lat??v.latitude);
  const lng=typeof v.lng==='function'?v.lng():Number(v.lng??v.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)?{latitude:lat,longitude:lng}:null;
}
function jarvisVoiceStepStart(step){
  let p=jarvisVoiceLatLng(step?.startLocation||step?.startLatLng);
  if(p)return p;
  const path=step?.path;
  if(Array.isArray(path)&&path.length)return jarvisVoiceLatLng(path[0]);
  return null;
}
function jarvisVoiceStepEnd(step){
  let p=jarvisVoiceLatLng(step?.endLocation||step?.endLatLng);
  if(p)return p;
  const path=step?.path;
  if(Array.isArray(path)&&path.length)return jarvisVoiceLatLng(path[path.length-1]);
  return null;
}
function jarvisVoiceManeuverPoint(step){
  // Google maneuver is performed at the beginning of the step.
  // Using the step end shifts guidance to the next junction / straight section.
  return jarvisVoiceStepStart(step)||jarvisVoiceStepEnd(step);
}
function jarvisVoiceSteps(){
  const src=(routeCandidates[selectedRouteIndex]||routeData)?.sourceRoute;
  const legs=src?.legs||[];const out=[];
  for(const leg of legs)for(const st of (leg?.steps||[]))out.push(st);
  return out;
}
function jarvisGuidanceDiagnosticText(){
  try{
    const evs=jarvisTurnEvents();
    const e=evs.find(x=>!Number.isFinite(jarvisMotion.displayS)||x.endS+8>=jarvisMotion.displayS) || evs[0];
    if(!e)return'案内診断: Google step案内なし';
    const st=jarvisVoiceSteps()[e.stepIndex];
    const ins=jarvisStepInstruction(st);
    return `案内診断: ${e.kind||'TURN'} / ${e.maneuver||'NO_MANEUVER'}${ins?' / '+ins:''}`;
  }catch(_){return'案内診断: 取得不可';}
}
function jarvisUpdateGuidanceDiagnostic(){
  const el=document.getElementById('jarvisGuidanceDiag');
  if(el)el.textContent=jarvisGuidanceDiagnosticText();
}
function jarvisLogVoiceEvent(text,accepted,reason,meta){
  try{
    window.__jarvisVoiceEvents.push({
      at:Date.now(),sessionId:jarvisVoiceSessionId,text:String(text||''),
      key:meta?.key||null,level:meta?.level||null,accepted:!!accepted,reason:reason||''
    });
    if(window.__jarvisVoiceEvents.length>2000)window.__jarvisVoiceEvents.splice(0,window.__jarvisVoiceEvents.length-2000);
  }catch(e){}
}
// v6.14.44 VOICE TRUTH: every call is recorded in window.__jarvisVoiceEvents, accepted or not, so
// callers (and the simulator) can tell "we asked to speak" apart from "speechSynthesis actually
// queued it". A caller that only marks its own state as announced when this returns true can no
// longer produce the earlier bug where a cooldown-rejected call was marked announced and then
// never spoken (v6.14.41 root cause).
function jarvisSpeak(text,force=false,meta=null){
  if(!voiceGuideEnabled||!text||!('speechSynthesis' in window)){jarvisLogVoiceEvent(text,false,'disabled',meta);return false;}
  const now=Date.now();
  if(!force&&now-voiceLastSpokenAt<2200){jarvisLogVoiceEvent(text,false,'cooldown',meta);return false;}
  try{
    if(force)window.speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(String(text));u.lang='ja-JP';u.rate=voiceRate;u.pitch=voicePitch;u.volume=voiceVolume;
    const voices=window.speechSynthesis.getVoices?.()||[];
    const jaVoices=voices.filter(v=>/^ja([-_]|$)/i.test(v.lang||''));
    const chosen=jaVoices.find(v=>(v.voiceURI||v.name)===voiceSelectedId)||jaVoices[0];if(chosen)u.voice=chosen;
    window.speechSynthesis.speak(u);voiceLastSpokenAt=now;
    jarvisLogVoiceEvent(text,true,'',meta);
    return true;
  }catch(e){console.warn('voice guide',e);jarvisLogVoiceEvent(text,false,'exception',meta);return false}
}
function jarvisVoiceId(v){return String(v?.voiceURI||v?.name||'');}
function jarvisPopulateVoiceSelect(){
  const sel=$('voiceSelect');if(!sel||!('speechSynthesis' in window))return;
  const voices=(window.speechSynthesis.getVoices?.()||[]).filter(v=>/^ja([-_]|$)/i.test(v.lang||''));
  const current=voiceSelectedId;sel.innerHTML='';
  if(!voices.length){const o=document.createElement('option');o.value='';o.textContent='日本語音声を読み込み中…';sel.appendChild(o);setTextIf('voiceSettingsStatus','日本語音声を読み込み中です。');return;}
  voices.forEach((v,i)=>{const o=document.createElement('option');o.value=jarvisVoiceId(v);o.textContent=`${v.name||'日本語音声'}${v.localService?'':'（オンライン）'}`;sel.appendChild(o);});
  if(current&&voices.some(v=>jarvisVoiceId(v)===current))sel.value=current;else{sel.value=jarvisVoiceId(voices[0]);voiceSelectedId=sel.value;}
  setTextIf('voiceSettingsStatus',`日本語音声 ${voices.length}種類を検出`);
}
function jarvisSyncVoiceSettingsUI(){
  const r=$('voiceRate'),p=$('voicePitch'),v=$('voiceVolume');if(r)r.value=String(voiceRate);if(p)p.value=String(voicePitch);if(v)v.value=String(voiceVolume);
  setTextIf('voiceRateValue',voiceRate.toFixed(2));setTextIf('voicePitchValue',voicePitch.toFixed(2));setTextIf('voiceVolumeValue',`${Math.round(voiceVolume*100)}%`);
  jarvisPopulateVoiceSelect();
}
function jarvisSaveVoiceSettings(){
  localStorage.setItem('jarvisVoiceId',voiceSelectedId);localStorage.setItem('jarvisVoiceRate',String(voiceRate));localStorage.setItem('jarvisVoicePitch',String(voicePitch));localStorage.setItem('jarvisVoiceVolume',String(voiceVolume));
}
function jarvisBindVoiceSettings(){
  bind('voiceSelect','change',e=>{voiceSelectedId=e.target.value||'';jarvisSaveVoiceSettings();});
  bind('voiceRate','input',e=>{voiceRate=Number(e.target.value);setTextIf('voiceRateValue',voiceRate.toFixed(2));jarvisSaveVoiceSettings();});
  bind('voicePitch','input',e=>{voicePitch=Number(e.target.value);setTextIf('voicePitchValue',voicePitch.toFixed(2));jarvisSaveVoiceSettings();});
  bind('voiceVolume','input',e=>{voiceVolume=Math.min(1,Math.max(0,Number(e.target.value)||0));voiceGuideEnabled=voiceVolume>0;setTextIf('voiceVolumeValue',`${Math.round(voiceVolume*100)}%`);jarvisUpdateVoiceButton();jarvisSaveVoiceSettings();});
  bind('voiceTestBtn','click',()=>{const was=voiceGuideEnabled;voiceGuideEnabled=true;jarvisSpeak('ジャービスです。音声案内のテストです。',true);voiceGuideEnabled=was;});
  if('speechSynthesis' in window){window.speechSynthesis.addEventListener?.('voiceschanged',jarvisPopulateVoiceSelect);setTimeout(jarvisPopulateVoiceSelect,250);setTimeout(jarvisPopulateVoiceSelect,1200);}
  jarvisSyncVoiceSettingsUI();
}

let jarvisArrivalResetBusy=false;
// v6.14.54 (integrating v6.14.49's road-tested policy natively): the destination pin is
// authoritative. The earlier 45m-pin-or-35m-route-end-shortcut policy could declare arrival while
// still meaningfully away from the actual destination, and kept the destination set afterward —
// requiring explicit user action to clear it. Require the real vehicle within 20m of the pin
// (with a sane accuracy fix) before accepting, then clear the destination/route outright.
function jarvisArrivalUpdate(){
  if(jarvisArrivalResetBusy||!navSessionStarted||navMode!=='ROUTE'||!destination||
     typeof currentLat!=='number'||typeof currentLon!=='number')return false;
  const pinDistance=haversine(
    {latitude:currentLat,longitude:currentLon},
    {latitude:destination.lat,longitude:destination.lon}
  );
  if(!Number.isFinite(pinDistance)||pinDistance>20)return false;
  // Ignore a clearly bad single fix near the destination. Normal iPhone GPS (<=40m) is accepted.
  const accuracy=Number(lastPos?.coords?.accuracy);
  if(Number.isFinite(accuracy)&&accuracy>40)return false;

  jarvisArrivalResetBusy=true;
  routeRequestSeq++;
  voiceArrivalSpoken=true;
  try{window.speechSynthesis?.cancel?.()}catch(e){}
  if(voiceGuideEnabled)jarvisSpeak('目的地に到着しました',true);
  jarvisRoadTestNoteLifecycle('ARRIVAL_20M_ACCEPTED',{pinDistance:Number(pinDistance.toFixed(1)),accuracy:Number.isFinite(accuracy)?accuracy:null});

  jarvisExitDeviationEscape();
  jarvisExitUTurnRecovery();
  jarvisMotionReset();
  jarvisClearTurnArrow();
  navSessionStarted=false;
  navMapFollow=false;navMapUserMoved=true;
  jarvisNavTrackingState='ARRIVED';
  // clearDestination() -> jarvisClearRoute() tears down the active session's route/destination
  // state; ARRIVED stays latched here so any late async reroute/update work cannot revive TRACKING.
  clearDestination();
  jarvisSetStatus('目的地に到着しました。目的地を消去しました','ok');

  setTimeout(()=>{jarvisArrivalResetBusy=false;},2500);
  return true;
}

function jarvisResetVoiceProgress(){
  voiceStepIndex=0;voiceAnnounced.clear();voiceArrivalSpoken=false;jarvisGuidanceCache=null;jarvisGuidanceCacheAt=0;jarvisGuidancePrevDistance.clear();
  jarvisLastGuidanceKeyBase=null;
  // v6.14.44 VOICE TRUTH stale-start guard: a new navigation session must never inherit the
  // previous session's speech cooldown timer or queued utterances. Without this, the simulator's
  // back-to-back scenarios could have their very first "approach" announcement silently dropped
  // because voiceLastSpokenAt was still recent from the PRIOR scenario's arrival announcement.
  jarvisVoiceSessionId++;
  voiceLastSpokenAt=0;
  try{window.speechSynthesis?.cancel?.()}catch(e){}
}
function jarvisUpdateVoiceButton(){
  const b=$('voiceGuideBtn');if(!b)return;
  const pct=Math.round(voiceVolume*100);
  b.textContent=pct===0?'🔇':pct<50?'🔉':'🔊';
  b.classList.toggle('active',pct>0);
  b.setAttribute('aria-label','音声音量を調整');
  const mv=$('mapVoiceVolume');if(mv)mv.value=String(pct);
  setTextIf('mapVoiceVolumeValue',`${pct}%`);
}
function jarvisSetMapVoiceVolume(v){
  const pct=Math.min(100,Math.max(0,Number(v)||0));
  voiceVolume=pct/100;
  voiceGuideEnabled=pct>0;
  localStorage.setItem('jarvisVoiceVolume',String(voiceVolume));
  localStorage.setItem('jarvisVoiceGuide',voiceGuideEnabled?'1':'0');
  const settingsVol=$('voiceVolume');if(settingsVol)settingsVol.value=String(voiceVolume);
  setTextIf('voiceVolumeValue',`${pct}%`);
  setTextIf('mapVoiceVolumeValue',`${pct}%`);
  jarvisUpdateVoiceButton();
  if(!voiceGuideEnabled){try{window.speechSynthesis?.cancel()}catch(e){}}
}
function jarvisToggleVolumePopup(e){
  e?.stopPropagation?.();
  const pop=$('voiceVolumePopup');if(!pop)return;
  pop.classList.toggle('hidden');
}
function jarvisCloseVolumePopup(){const pop=$('voiceVolumePopup');if(pop)pop.classList.add('hidden');}
function jarvisVoiceGuideUpdate(){
  if(!voiceGuideEnabled||!navSessionStarted||navMode!=='ROUTE'||!Number.isFinite(jarvisMotion.displayS))return;

  // v6.14.7: arrow / voice / 70m zoom share one stabilized guidance event.
  // A short cache prevents one noisy GPS projection from making guidance disappear.
  const turn=jarvisCurrentGuidanceEvent();
  if(!turn)return;
  const d=turn.distance;
  if(!Number.isFinite(d))return;

  // Never issue a new RIGHT/LEFT call after the maneuver has already begun.
  // This suppresses the dangerous "straight road after junction -> turn now" symptom.
  if(d < -2 || jarvisMotion.displayS>turn.endS+3)return;

  const prev=jarvisGuidancePrevDistance.get(turn.key);
  jarvisGuidancePrevDistance.set(turn.key,d);

  // Threshold crossing is tolerant of GPS jumps (e.g. 92m -> 51m).
  // Direct <= checks also cover the first fix arriving already inside the zone.
  const crossedApproach=Number.isFinite(prev)?(prev>100&&d<=100):(d<=100);
  const crossedNear=Number.isFinite(prev)?(prev>25&&d<=25):(d<=25);

  let level='';
  if(d<=25)level='near';
  else if(d<=100)level='approach';
  if(!level)return;

  const text=jarvisGuidanceVoiceText(turn,level);
  if(!text)return;
  const key=`${turn.key}:${level}`;
  if(voiceAnnounced.has(key))return;

  // If we are in-zone, announce even when the exact threshold was skipped.
  if((level==='near'&&(crossedNear||d<=25))||(level==='approach'&&(crossedApproach||d<=100))){
    // v6.14.44 VOICE TRUTH queue replacement: turn.key (stable per-maneuver, see jarvisTurnEvents)
    // changing from the last maneuver we actually announced means guidance moved on to a
    // different junction (a new step, or a post-reroute maneuver). Any utterance for the OLD
    // maneuver still sitting in the speechSynthesis queue is now a stale stage and must not be
    // allowed to play after this new one; cancel it first.
    if(jarvisLastGuidanceKeyBase!==null&&jarvisLastGuidanceKeyBase!==turn.key){
      try{window.speechSynthesis?.cancel?.()}catch(e){}
    }
    // Mark announced ONLY when jarvisSpeak actually accepted the request (voice truth). A
    // cooldown-rejected attempt is left unmarked so the next tick can retry it, instead of the
    // stage being silently lost forever (the v6.14.41 root cause) or, via key drift elsewhere,
    // being announced twice (the "voice duplicate" symptom this build targets).
    if(jarvisSpeak(text,false,{key,level})){
      voiceAnnounced.add(key);
      jarvisLastGuidanceKeyBase=turn.key;
    }
  }
}

function jarvisRouteButtonTextColor(i){
  return i===0?'#ffffff':'#062032';
}
function jarvisSyncMapActionButton(){
  const b=$('mapStartBtn'); if(!b)return;
  if(navSessionStarted){
    b.innerHTML='<span class="map-action-main">↻ REROUTE</span><span class="map-action-sub">現在地から再検索</span>';
    b.style.background='rgba(30,40,52,.58)';
    b.style.color='rgba(255,255,255,.88)';
    b.style.borderColor='rgba(255,255,255,.30)';
    return;
  }
  const r=routeCandidates[selectedRouteIndex]||routeData;
  const mins=r?Math.max(1,Math.round((Number(r.durationMillis)||0)/60000)):'--';
  const dist=r?jarvisRouteDistanceText(r):'-- km';
  b.innerHTML=`<span class="map-action-main">▶ START</span><span class="map-action-sub">${mins}分 · ${dist}</span>`;
  b.style.background=jarvisRouteButtonColor(selectedRouteIndex);
  b.style.color=jarvisRouteButtonTextColor(selectedRouteIndex);
  b.style.borderColor='rgba(255,255,255,.34)';
}
function jarvisUpdateMapStartButton(){
  const b=$('mapStartBtn');if(!b)return;
  const show=navMode==='ROUTE'&&routeCandidates.length>0;
  b.classList.toggle('hidden',!show);
  b.classList.toggle('nav-running',navSessionStarted);
  jarvisSyncMapActionButton();
  b.disabled=false;
}
// v6.14.44 START ORIGIN GUARD (previously unimplemented). Before navigation starts, validate
// that the selected route actually goes from where the rider is to where they asked to go.
// This catches a stale/corrupted route slipping through (e.g. a route response that raced a
// destination change, or a reversed/garbled path) BEFORE it becomes the vehicle's guidance
// authority. Never silently "fix" a suspicious route (e.g. by reversing its path) - either
// accept it, warn, or refuse to start and require a fresh jarvisComputeRoute().
//
// v6.14.45 fix: route-PATH integrity (is this route itself well-formed and forward-facing?)
// must be judged against `routeLastOrigin` — the position jarvisComputeRoute() actually used
// to request this specific route — not against the rider's CURRENT live position. Those are
// different questions. A rider who walks/drifts 100m away from where they requested the route
// (a very ordinary thing to happen between computing a route and pressing START) has a route
// that is still perfectly valid — ITS start still matches routeLastOrigin exactly — but the old
// code compared the route's start point to `currentLat/currentLon` first and would have blocked
// this valid route as "CORRUPT" purely because the rider had moved. Live-position distance is
// still computed and surfaced (`liveOriginDistance`), and can still promote a clean route to a
// WARN so the rider is told the vehicle isn't at the route's start yet — but it never blocks by
// itself, and it never affects orientation/CORRUPT/REVERSED classification, which are about the
// route's own geometry versus the truth it was computed from.
let jarvisRouteIntegrity={checkedAt:0,status:'UNKNOWN',startDistance:null,endDistance:null,liveOriginDistance:null,orientationOk:null,blocked:false,reason:''};
function jarvisStartOriginGuard(){
  const route=routeCandidates[selectedRouteIndex]||routeData;
  const path=route?.path;
  const result={checkedAt:Date.now(),status:'OK',startDistance:null,endDistance:null,liveOriginDistance:null,orientationOk:true,blocked:false,reason:''};
  if(!Array.isArray(path)||path.length<2){
    result.status='NO_ROUTE';result.blocked=true;result.reason='ルートpathがありません';
    jarvisRouteIntegrity=result;return result;
  }
  const startPt=jarvisNormalizePathPoint(path[0]);
  const endPt=jarvisNormalizePathPoint(path[path.length-1]);
  if(!startPt||!endPt){
    result.status='INVALID_POINTS';result.blocked=true;result.reason='ルート座標が不正です';
    jarvisRouteIntegrity=result;return result;
  }
  // Route-request truth: the position jarvisComputeRoute() actually built THIS route from.
  // Always set alongside routeCandidates/routeData (see jarvisComputeRoute), so this is the
  // primary basis for judging the route's own integrity.
  const requestOrigin=routeLastOrigin?{lat:routeLastOrigin.latitude,lng:routeLastOrigin.longitude}:null;
  // Live vehicle position: separate, diagnostic-only evidence. The rider may have moved since
  // the route was computed; that says something about whether they're currently ON the route's
  // start, not about whether the route itself is valid.
  const liveOrigin=(typeof currentLat==='number'&&typeof currentLon==='number')?{lat:currentLat,lng:currentLon}:null;
  // Fall back to live position only when routeLastOrigin genuinely isn't available (e.g. a route
  // restored from a snapshot that didn't carry it) — never prefer it over route-request truth.
  const origin=requestOrigin||liveOrigin;

  if(origin)result.startDistance=haversine({latitude:origin.lat,longitude:origin.lng},{latitude:startPt.lat,longitude:startPt.lng});
  if(destination)result.endDistance=haversine({latitude:endPt.lat,longitude:endPt.lng},{latitude:destination.lat,longitude:destination.lon});
  if(liveOrigin)result.liveOriginDistance=haversine({latitude:liveOrigin.lat,longitude:liveOrigin.lng},{latitude:startPt.lat,longitude:startPt.lng});

  // Forward-vs-reverse orientation sanity: a route whose END is actually near where we ARE,
  // and whose START is near where we're GOING, is very likely backwards. Judged against
  // route-request truth (`origin`), not live position, for the same reason as above.
  if(origin&&destination){
    const startToDest=haversine({latitude:startPt.lat,longitude:startPt.lng},{latitude:destination.lat,longitude:destination.lon});
    const endToOrigin=haversine({latitude:endPt.lat,longitude:endPt.lng},{latitude:origin.lat,longitude:origin.lng});
    const looksReversed=Number.isFinite(result.startDistance)&&result.startDistance>30&&
      endToOrigin<result.startDistance*.6 && startToDest<(result.endDistance??Infinity)*.6;
    result.orientationOk=!looksReversed;
  }

  // v6.14.54 (integrating v6.14.51's road-tested policy natively): START integrity must primarily
  // prove that the computed route begins near the rider. Google Routes may legitimately terminate
  // at an accessible road/entrance some distance from a POI pin (large temples, parks, stations,
  // shopping centres, private roads, etc.) — judge start/end distance separately rather than by
  // their max, and give the destination endpoint much more slack before blocking.
  if(!result.orientationOk){
    result.status='REVERSED';result.blocked=true;result.reason='ルートの向きが逆転している可能性があります。再検索してください';
  }else if(Number.isFinite(result.startDistance)&&result.startDistance>80){
    result.status='CORRUPT';result.blocked=true;result.reason=`ルート起点が現在地から${Math.round(result.startDistance)}mずれています。再検索してください`;
  }else if(Number.isFinite(result.endDistance)&&result.endDistance>750){
    result.status='CORRUPT';result.blocked=true;result.reason=`ルート終点が目的地から${Math.round(result.endDistance)}m離れています。再検索してください`;
  }else if(Number.isFinite(result.endDistance)&&result.endDistance>250){
    result.status='WARN';result.blocked=false;result.reason=`走行可能なルート終点が目的地ピンから${Math.round(result.endDistance)}m離れています`;
  }else if(Number.isFinite(result.startDistance)&&result.startDistance>30){
    result.status='WARN';result.blocked=false;result.reason=`ルート起点に${Math.round(result.startDistance)}mのずれがあります`;
  }else{
    result.status='OK';result.blocked=false;result.reason='';
  }

  // Live-position mismatch: non-blocking evidence that the rider isn't at the route's start
  // right now (they may simply have moved since computing it). Only surfaced when it's
  // MEANINGFULLY worse than the route-request-truth distance already computed above — otherwise
  // this is just restating the same number a second time when requestOrigin was unavailable and
  // liveOrigin was already used as `origin`.
  if(!result.blocked && Number.isFinite(result.liveOriginDistance) && result.liveOriginDistance>80 &&
     (!Number.isFinite(result.startDistance) || result.liveOriginDistance>result.startDistance+40)){
    const moveNote=`現在地がルート起点から${Math.round(result.liveOriginDistance)}m離れています（計算後に移動した可能性）`;
    result.reason=result.reason?`${result.reason}／${moveNote}`:moveNote;
    if(result.status==='OK')result.status='WARN';
  }

  jarvisRouteIntegrity=result;
  return result;
}
function jarvisStartNavigation(){
  jarvisArrivalResetBusy=false;
  if(navMode==='ROUTE'&&routeCandidates.length){
    if(navSessionStarted){ jarvisEnterDeviationEscape('OFF_ROUTE'); jarvisAutoReroute(); return; }
    const integrity=jarvisStartOriginGuard();
    if(integrity.blocked){
      jarvisSetStatus(`START中止：${integrity.reason}`,'bad');
      return;
    }
    if(integrity.status==='WARN')jarvisSetStatus(`注意：${integrity.reason}`,'warn');
    // START直前まで走っていた候補取得リクエストを無効化。遅れて返った応答が走行状態を解除するのを防ぐ。
    routeRequestSeq++;
    navSessionStarted=true;
  jarvisBlurTextInputs();routePreviewActive=false;navMapFollow=true;navMapUserMoved=false;jarvisExitDeviationEscape();jarvisResetAutoRerouteWatch();jarvisSyncTrafficLayers();
    jarvisMotionReset();
    jarvisExitUTurnRecovery();
    jarvisAutoDeviationCount=0;
    const startRoute=routeCandidates[selectedRouteIndex]||routeData;
    jarvisOriginalRoutePath=startRoute?.path?.map(jarvisNormalizePathPoint).filter(Boolean)||[];
    jarvisPrepareOriginalRouteSnapshot(startRoute);
    jarvisResetVoiceProgress();
    jarvisClearRouteLabels();jarvisRenderRoute();jarvisUpdateMapStartButton();
    if(voiceGuideEnabled)jarvisSpeak('音声案内を開始します',true);
    // Google Maps風：走行開始時は現在地へ寄り、進行方向の先が見やすい縮尺へ。
    if(typeof currentLat==='number'&&typeof currentLon==='number'){
      navGoogleMap?.setCenter({lat:currentLat,lng:currentLon});
      navGoogleMap?.setZoom(18);
      jarvisMotionAcceptFix(currentLat,currentLon,currentSpeedKmh);
      jarvisMotionStart();
    }
    // v6.14.54: enforce keep-awake at the moment navigation actually starts, rather than relying
    // only on the NAV panel being visible (see jarvisWakeWanted).
    requestWakeLock().catch?.(()=>{});
  }
  if(!running&&!starting)startGPS();
}
async function jarvisStopRouteNavigation(){
  if(navMode!=='ROUTE')return;
  navSessionStarted=false;routePreviewActive=true;navMapFollow=false;navMapUserMoved=true;jarvisExitDeviationEscape();jarvisResetAutoRerouteWatch();jarvisSyncTrafficLayers();
  jarvisMotionReset();
  jarvisExitUTurnRecovery();
  jarvisAutoDeviationCount=0;jarvisOriginalRoutePath=[];
  jarvisClearOriginalRouteSnapshot();
  jarvisResetVoiceProgress();
  jarvisUpdateMapStartButton();
  jarvisSetStatus('現在地から最速ルートを再計算中…');
  // GPS計測自体は継続し、現在位置から候補を取り直す。
  await jarvisComputeRoute(true);
}
// v6.14.54: atomic route rendering for BOTH the started-nav single-route case and the pre-START
// 3-candidate preview case. The previous implementation tore every existing polyline down first
// and only then built replacements — if construction failed partway (or threw), the map was left
// with no route line at all until the next successful call. A single external overlay
// (road-test-fixes.js) later added an atomic build-then-swap for the started-nav case only; the
// preview case never got the fix. Both branches now build and verify new polylines first, and
// only then dispose of whatever they are replacing, so a failed rebuild can never leave the map
// with fewer route lines than it had before this call.
function jarvisRenderRoute(){
  const colors=['#238cff','#72d2ff','#8ee6a8'];
  jarvisClearRouteLabels();

  if(routePreviewActive&&!navSessionStarted&&routeCandidates.length)jarvisComputeRouteLabelPoints();

  if(navGoogleMap&&routeCandidates.length){
    if(navSessionStarted){
      // START後は「選択中ルート1本」だけ。
      const r=routeCandidates[selectedRouteIndex]||routeData;
      if(r?.path?.length>=2){
        let fresh=null;
        try{
          fresh=new google.maps.Polyline({map:navGoogleMap,path:r.path,strokeColor:'#238cff',strokeOpacity:jarvisDeviationEscape?.22:.98,strokeWeight:jarvisDeviationEscape?7:11,zIndex:20,clickable:false});
          if((fresh.getPath?.().getLength?.()||0)<2)throw new Error('replacement route path too short');
          const oldPrimary=navRouteLine,oldLines=navAltRouteLines.slice();
          navRouteLine=fresh;navAltRouteLines=[fresh];
          for(const line of oldLines){
            if(line===fresh)continue;
            try{line?.setMap?.(null)}catch(e){}
            try{line?.remove?.()}catch(e){}
          }
          if(oldPrimary&&oldPrimary!==fresh&&!oldLines.includes(oldPrimary)){try{oldPrimary.setMap?.(null)}catch(e){}}
        }catch(e){
          try{fresh?.setMap?.(null)}catch(_){}
          // Construction failed: leave whatever was already on the map untouched.
        }
      }
    }else{
      // START前だけ候補3本を表示。1候補につきPolylineは1本。build everything first, verify at
      // least one candidate rendered, THEN swap — a mid-build failure must never leave zero lines.
      const built=[];
      try{
        routeCandidates.forEach((r,i)=>{
          if(!r?.path?.length)return;
          const selected=i===selectedRouteIndex;
          const line=new google.maps.Polyline({map:navGoogleMap,path:r.path,strokeColor:colors[i]||'#72d2ff',strokeOpacity:selected?.98:.76,strokeWeight:selected?11:7,zIndex:selected?16:10-i,clickable:true});
          line.addListener('click',()=>jarvisSelectRoute(i));
          built.push({line,i});
        });
        if(!built.length)throw new Error('no candidate paths to render');
        const oldLines=navAltRouteLines.slice(),oldPrimary=navRouteLine;
        navAltRouteLines=built.map(b=>b.line);
        navRouteLine=null;
        for(const line of oldLines){
          try{line?.setMap?.(null)}catch(e){}
          try{line?.remove?.()}catch(e){}
        }
        if(oldPrimary&&!oldLines.includes(oldPrimary)){try{oldPrimary.setMap?.(null)}catch(e){}}
        if(routePreviewActive)built.forEach(b=>navRouteLabels.push(jarvisCreateRouteLabel(navGoogleMap,routeCandidates[b.i],b.i)));
      }catch(e){
        for(const b of built){try{b.line?.setMap?.(null)}catch(_){}}
        // Leave whatever was already on the map untouched.
      }
    }
  }else{
    // No candidates at all (destination cleared, etc.): this IS the correct state, tear down.
    for(const line of navAltRouteLines){try{line?.setMap?.(null)}catch(e){}try{line?.remove?.()}catch(e){}}
    navAltRouteLines=[];
    if(navRouteLine){try{navRouteLine.setMap(null)}catch(e){}navRouteLine=null;}
  }

  if(landGoogleMap&&routeData?.path?.length>=2){
    let freshLand=null;
    try{
      freshLand=new google.maps.Polyline({map:landGoogleMap,path:routeData.path,strokeColor:colors[selectedRouteIndex]||'#238cff',strokeOpacity:.94,strokeWeight:10,zIndex:12});
      if((freshLand.getPath?.().getLength?.()||0)<2)throw new Error('replacement land route path too short');
      const oldLand=landRouteLine;
      landRouteLine=freshLand;
      if(oldLand&&oldLand!==freshLand){try{oldLand.setMap?.(null)}catch(e){}}
    }catch(e){try{freshLand?.setMap?.(null)}catch(_){}}
  }else if(landGoogleMap&&landRouteLine&&!routeData?.path?.length){
    try{landRouteLine.setMap(null)}catch(e){}landRouteLine=null;
  }

  if(navSessionStarted&&jarvisDeviationEscape)jarvisSetRouteGuidanceAppearance(false);
  if(routePreviewActive&&!navSessionStarted)jarvisFitRoutePreview();
  // START後はfitBounds禁止。motion engineがzoom 18で現在位置を追従。
  jarvisUpdateMapStartButton();
  if(mapViewMode==='3D')jarvisApplyVector3D();
}
// v6.14.54: single self-heal watchdog for route-line integrity, replacing what was previously a
// separate 300ms poller living outside this file (road-test-ui.js's routeLineGuard) racing against
// whatever else could call jarvisRenderRoute. Cheap to call often; only rebuilds when the active
// route's line has actually gone missing or detached from the current map instance.
function jarvisVerifyRouteRendered(){
  if(!navSessionStarted||navMode!=='ROUTE'||!navGoogleMap)return;
  const r=routeCandidates[selectedRouteIndex]||routeData;
  if(!r?.path?.length)return;
  let ok=false;
  try{ok=!!navRouteLine&&navRouteLine.getMap?.()===navGoogleMap&&(navRouteLine.getPath?.().getLength?.()||0)>=2;}catch(e){}
  if(!ok){
    jarvisRenderRoute();
    jarvisRoadTestNoteLifecycle('ROUTE_LINE_SELF_HEAL',{});
  }
}
setInterval(jarvisVerifyRouteRendered,1500);


function jarvisRoutePointDistanceMeters(lat,lon,a,b){
  // Local equirectangular projection is accurate enough for short route segments.
  const R=6371000, rad=Math.PI/180;
  const lat0=lat*rad, cos=Math.cos(lat0);
  const ax=(a.lng-lon)*rad*cos*R, ay=(a.lat-lat)*rad*R;
  const bx=(b.lng-lon)*rad*cos*R, by=(b.lat-lat)*rad*R;
  const dx=bx-ax, dy=by-ay;
  const den=dx*dx+dy*dy;
  let u=den>0?-(ax*dx+ay*dy)/den:0;
  u=Math.max(0,Math.min(1,u));
  const x=ax+u*dx, y=ay+u*dy;
  return Math.hypot(x,y);
}
function jarvisDistanceFromActiveRoute(lat,lon){
  const path=(routeCandidates[selectedRouteIndex]||routeData)?.path||[];
  if(path.length<2)return Infinity;
  let best=Infinity;
  // Full scan is acceptable for current route sizes; no network request is involved.
  for(let i=1;i<path.length;i++){
    const d=jarvisRoutePointDistanceMeters(lat,lon,path[i-1],path[i]);
    if(d<best)best=d;
    if(best<8)break;
  }
  return best;
}

// v6.14.28 REROUTE CORRIDOR: jarvisAutoRerouteUpdate() consumes this directly for OFF_ROUTE/
// reroute evidence. The old single-pass distance+heading scorer could pick a less relevant
// segment at a turn (the same failure mode jarvisMotionProject had before v6.14.27) and
// generate false heading/lateral off-route evidence even while route-progress projection
// remained essentially on-route. Select by geometry + progress continuity FIRST (heading-blind,
// like the route-projection corridor); heading mismatch is computed only after the segment is
// chosen and remains valid off-route evidence.
let jarvisRerouteDiag={rerouteCorridorUsed:null,rerouteDistance:null,rerouteMismatch:null,rerouteS:null};
// v6.14.54: delegates to the same jarvisCorridorMatch core jarvisMotionProject uses, anchored to
// the same jarvisMotion.targetS progress value — previously this had its own 15m/heading-only-
// fallback implementation with no distance bound, which is the direct cause of far-ahead
// overlapping-route segments being selected as reroute evidence (see jarvisCorridorMatch's header).
function jarvisNearestActiveRoute(lat,lon,accuracyM){
  if(!jarvisMotionPreparePath())return null;
  const travel=jarvisTravelHeading();
  const acc=Number.isFinite(accuracyM)?accuracyM:Number(lastPos?.coords?.accuracy);
  const best=jarvisCorridorMatch(jarvisMotion.pts,jarvisMotion.cum,jarvisMotion.total,lat,lon,jarvisMotion.targetS,currentSpeedKmh,travel,acc);
  if(!best)return null;
  const mismatch=(Number.isFinite(travel)&&currentSpeedKmh>=4)?jarvisHeadingMismatch(travel,best.heading):0;
  jarvisRerouteDiag.rerouteCorridorUsed=best.localCorridorUsed;
  jarvisRerouteDiag.rerouteDistance=best.distance;
  jarvisRerouteDiag.rerouteMismatch=mismatch;
  jarvisRerouteDiag.rerouteS=best.s;
  return {distance:best.distance,segmentIndex:best.segmentIndex,u:best.u,heading:best.heading,mismatch,s:best.s};
}

function jarvisHeadingMismatch(a,b){
  if(!Number.isFinite(a)||!Number.isFinite(b))return 0;
  return Math.abs(((a-b+540)%360)-180);
}

function jarvisResetAutoRerouteWatch(){
  autoRerouteOffRouteSince=0;
  autoRerouteOffRouteFixes=0;
  if(!jarvisDeviationEscape)jarvisDeviationEvidence=0;
}

function jarvisNormalizePathPoint(p){
  if(!p)return null;
  const lat=typeof p.lat==='function'?p.lat():Number(p.lat??p.latitude);
  const lng=typeof p.lng==='function'?p.lng():Number(p.lng??p.longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)?{lat,lng}:null;
}
function jarvisDestinationPoint(a,b,dMeters){
  const brng=(b||0)*Math.PI/180, R=6371000;
  const lat1=a.lat*Math.PI/180, lon1=a.lng*Math.PI/180, dr=dMeters/R;
  const lat2=Math.asin(Math.sin(lat1)*Math.cos(dr)+Math.cos(lat1)*Math.sin(dr)*Math.cos(brng));
  const lon2=lon1+Math.atan2(Math.sin(brng)*Math.sin(dr)*Math.cos(lat1),Math.cos(dr)-Math.sin(lat1)*Math.sin(lat2));
  return {lat:lat2*180/Math.PI,lng:lon2*180/Math.PI};
}
function jarvisActiveViaPoints(){
  return routeViaPoints.filter(p=>!p.visited);
}
function jarvisUpdateViaVisited(lat,lon){
  let changed=false;
  for(const p of routeViaPoints){
    if(p.visited)continue;
    const d=haversine({latitude:lat,longitude:lon},{latitude:p.lat,longitude:p.lng});
    if(d<=120){p.visited=true;changed=true}
  }
  if(changed){
    jarvisRenderViaMarkers();
    localStorage.setItem('jarvisRouteViaPoints',JSON.stringify(routeViaPoints));
  }
}
function jarvisRenderViaMarkers(){
  routeViaMarkers.forEach(m=>{try{m.setMap(null)}catch(e){}}); routeViaMarkers=[];
  if(!navGoogleMap||!routeViaPoints.length)return;
  routeViaPoints.forEach((p,i)=>{
    const m=new google.maps.Marker({
      map:navGoogleMap,
      position:{lat:p.lat,lng:p.lng},
      title:p.visited?`経由${i+1} 通過済み`:`経由${i+1}（タップで削除）`,
      label:{text:String(i+1),color:'#ffffff',fontWeight:'700'},
      opacity:p.visited?.45:1,
      zIndex:30
    });
    m.addListener('click',()=>{
      if(navSessionStarted)return;
      routeViaPoints.splice(i,1);
      localStorage.setItem('jarvisRouteViaPoints',JSON.stringify(routeViaPoints));
      jarvisRenderViaMarkers();
      jarvisSetStatus('経由地を削除しました。ルートを再計算中…','ok');
      jarvisComputeRoute(true);
    });
    routeViaMarkers.push(m);
  });
}
function jarvisSetDestinationFromLongPress(latLng){
  const lat=typeof latLng?.lat==='function'?latLng.lat():Number(latLng?.lat),lng=typeof latLng?.lng==='function'?latLng.lng():Number(latLng?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  destination={lat,lon:lng,name:'地図で指定した地点'};
  jarvisBlurTextInputs();
  routeViaPoints=[];localStorage.setItem('jarvisRouteViaPoints','[]');
  jarvisRenderViaMarkers();
  jarvisSetStatus('長押し地点を目的地に設定。ルートを計算中…','ok');
  jarvisComputeRoute(true);
}
function jarvisLongPressAction(ll){if(navSessionStarted)return;if(destination)jarvisAddViaPoint(ll);else jarvisSetDestinationFromLongPress(ll);}

function jarvisAddViaPoint(latLng){
  if(navSessionStarted){
    jarvisSetStatus('経由地の追加は停車してルート選択中に行ってください','warn'); return;
  }
  if(!destination){
    jarvisSetStatus('先に目的地を設定してください','warn'); return;
  }
  const lat=typeof latLng?.lat==='function'?latLng.lat():Number(latLng?.lat);
  const lng=typeof latLng?.lng==='function'?latLng.lng():Number(latLng?.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  if(routeViaPoints.length>=3){
    jarvisSetStatus('経由地は試験版では3か所までです','warn'); return;
  }
  routeViaPoints.push({lat,lng,visited:false});
  localStorage.setItem('jarvisRouteViaPoints',JSON.stringify(routeViaPoints));
  jarvisRenderViaMarkers();
  jarvisSetStatus(`経由地${routeViaPoints.length}を追加。この道を通るルートを計算中…`,'ok');
  jarvisComputeRoute(true);
}
function jarvisBindMapLongPress(){
  if(!navGoogleMap||navGoogleMap.__jarvisLongPressBound)return;
  navGoogleMap.__jarvisLongPressBound=true;
  // Google Maps JS has a native long-press event path that works more reliably on iPhone
  // than synthesizing it from mouse events. Keep the mouse fallback for desktop testing.
  let firedAt=0;
  const fire=(ll)=>{
    if(!ll||navSessionStarted)return;
    const now=Date.now();
    if(now-firedAt<900)return;
    firedAt=now;
    if(navigator.vibrate)try{navigator.vibrate(35)}catch(e){}
    jarvisLongPressAction(ll);
  };
  navGoogleMap.addListener('longpress',e=>fire(e?.latLng));

  const cancel=()=>{
    if(jarvisLongPressTimer){clearTimeout(jarvisLongPressTimer);jarvisLongPressTimer=null}
    jarvisLongPressLatLng=null;
  };
  navGoogleMap.addListener('mousedown',e=>{
    cancel();
    if(navSessionStarted)return;
    jarvisLongPressLatLng=e?.latLng||null;
    if(!jarvisLongPressLatLng)return;
    jarvisLongPressTimer=setTimeout(()=>{
      const ll=jarvisLongPressLatLng;
      jarvisLongPressTimer=null;jarvisLongPressLatLng=null;
      fire(ll);
    },650);
  });
  navGoogleMap.addListener('mouseup',cancel);
  navGoogleMap.addListener('dragstart',cancel);
}
function jarvisFindRejoinWaypoint(){
  const path=jarvisOriginalRoutePath.map(jarvisNormalizePathPoint).filter(Boolean);
  if(path.length<2||typeof currentLat!=='number'||typeof currentLon!=='number')return null;
  let bestI=0,bestD=Infinity;
  for(let i=0;i<path.length;i++){
    const d=haversine({latitude:currentLat,longitude:currentLon},{latitude:path[i].lat,longitude:path[i].lng});
    if(d<bestD){bestD=d;bestI=i}
  }
  let acc=0;
  for(let i=bestI+1;i<path.length;i++){
    acc+=haversine({latitude:path[i-1].lat,longitude:path[i-1].lng},{latitude:path[i].lat,longitude:path[i].lng});
    if(acc>=350)return path[i];
  }
  return path[Math.min(path.length-1,bestI+1)]||null;
}
function jarvisRequestIntermediates(strategy='NORMAL'){
  // v6.14: never invent a forward waypoint for reroute. On divided roads that point can
  // snap to the opposite carriageway/ramp and produce absurd U-turn routes.
  // Keep only user-declared via points (and legacy REJOIN only for explicit/manual use).
  const pts=jarvisActiveViaPoints().map(p=>({lat:p.lat,lng:p.lng}));
  if(strategy==='REJOIN'){
    const p=jarvisFindRejoinWaypoint();
    if(p)pts.push(p);
  }
  return pts.slice(0,4).map(p=>({location:{lat:p.lat,lng:p.lng}}));
}

function jarvisRouteInitialHeading(route){
  const pts=route?.path||[];
  if(pts.length<2)return null;
  let acc=0;
  for(let i=1;i<pts.length;i++){
    const a=jarvisNormalizePathPoint(pts[i-1]),b=jarvisNormalizePathPoint(pts[i]);
    if(!a||!b)continue;
    const d=haversine({latitude:a.lat,longitude:a.lng},{latitude:b.lat,longitude:b.lng});
    acc+=d;
    if(acc>=18||i===pts.length-1)return bearing(a.lat,a.lng,b.lat,b.lng);
  }
  return null;
}
function jarvisRouteCandidateScore(route,travelHeading){
  const dur=Math.max(1,Number(route?.durationMillis)||1e12);
  const initial=jarvisRouteInitialHeading(route);
  const mismatch=(Number.isFinite(travelHeading)&&Number.isFinite(initial))?jarvisHeadingMismatch(travelHeading,initial):0;
  // Strongly reject routes that begin behind the rider, but still keep duration relevant.
  const reversePenalty=mismatch>125?45*60*1000:mismatch>95?18*60*1000:mismatch>70?6*60*1000:mismatch*1400;
  return {score:dur+reversePenalty,mismatch,initial,duration:dur};
}

function jarvisRebaseMotionToCurrentRoute(lat,lon,speedKmh){
  jarvisMotionReset();
  const p=jarvisMotionProject(lat,lon);
  if(!p)return null;
  const routeHeading=jarvisMotionHeadingAtS(p.s);
  const travel=jarvisTravelHeading();
  const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,routeHeading):0;
  // API origin is a few seconds old by the time the response arrives. Up to 90m is acceptable
  // if the new route still points roughly where the vehicle is actually travelling.
  const maxDist=(Number(speedKmh)||0)>=7?90:65;
  if(p.distance>maxDist||(Number(speedKmh)>=7&&mismatch>105))return null;
  const now=performance.now();
  jarvisMotion.targetS=p.s;
  jarvisMotion.displayS=p.s;
  jarvisMotion.lastProjection=p;
  jarvisMotion.lastFixAt=now;
  jarvisMotion.speedMps=Math.max(0,Math.min(45,(Number(speedKmh)||0)/3.6));
  jarvisMotion.displayHeading=routeHeading;
  return p;
}


let jarvisUTurnRecovery=false;
let jarvisUTurnAlignedFixes=0;
let jarvisUTurnRecoveryStartedAt=0;
let jarvisUTurnRecoveryStartPos=null;

function jarvisNewRouteRecoveryState(lat,lon,speedKmh){
  if(!jarvisMotionPreparePath())return null;
  const p=jarvisMotionProject(lat,lon);
  if(!p)return null;
  const routeHeading=jarvisMotionHeadingAtS(p.s);
  const travel=jarvisTravelHeading();
  const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,routeHeading):0;
  return {p,routeHeading,travel,mismatch,distance:p.distance,speed:Number(speedKmh)||0};
}

function jarvisEnterUTurnRecovery(state){
  jarvisUTurnRecovery=true;
  jarvisUTurnAlignedFixes=0;
  jarvisUTurnRecoveryStartedAt=Date.now();
  jarvisUTurnRecoveryStartPos=(typeof currentLat==='number'&&typeof currentLon==='number')?{lat:currentLat,lng:currentLon}:null;
  jarvisDeviationEscape=true; // real vehicle remains the squid authority until it faces the route.
  jarvisSetRouteGuidanceAppearance(true); // show the NEW route clearly; it is now guidance, not stale.
  jarvisSetStatus('安全な場所でUターンしてください','warn');
  if(voiceGuideEnabled)jarvisSpeak('安全な場所でUターンしてください',true);
}

function jarvisExitUTurnRecovery(){
  jarvisUTurnRecovery=false;
  jarvisUTurnAlignedFixes=0;
  jarvisUTurnRecoveryStartedAt=0;
  jarvisUTurnRecoveryStartPos=null;
}

// ===== v6.14.54: single route-commit path =====
// The only function allowed to write routeCandidates/selectedRouteIndex/routeData/routeLastOrigin/
// routeLastAt/routeRequestSeq. Previously a "restore the original route" code path (external
// road-test-v653.js overlay) wrote these directly, bypassing routeRequestSeq/telemetry bookkeeping
// entirely. Both a freshly fetched route (jarvisComputeRoute) and a restored frozen route
// (jarvisRestoreOriginalRoute) now go through here, so there is exactly one way a "new active
// route" can come into existence.
function jarvisCommitRoute(candidates,selectedIndex,meta={}){
  const{origin=null,reason='ROUTE_COMMITTED'}=meta;
  routeCandidates=candidates;
  selectedRouteIndex=Math.max(0,Math.min(candidates.length-1,selectedIndex||0));
  routeData=routeCandidates[selectedRouteIndex]||null;
  if(origin)routeLastOrigin=origin;
  routeLastAt=Date.now();
  routeRequestSeq++;
  // A route committed WHILE already navigating (a reroute, or a restored original route) needs a
  // short settle window before off-route evidence can accumulate against it again — see
  // jarvisAutoRerouteUpdate. The very first route computed before/at START never gets this: there
  // is no prior deviation to settle from, and routeLastAt being "recent" then is not evidence of one.
  if(reason==='REROUTE'||reason==='ORIGINAL_ROUTE_REJOIN')jarvisRouteSettleUntil=routeLastAt+AUTO_REROUTE_SETTLE_MS;
  jarvisRoadTestNoteLifecycle('ROUTE_COMMITTED',{reason,generation:routeRequestSeq,candidateCount:candidates.length});
  return routeData;
}

// Freezes the route chosen at START as a separate, corridor-matchable path. Only ever compared
// against for "did the rider physically return to where they began" — never mutated once set.
function jarvisPrepareOriginalRouteSnapshot(route){
  const path=route?.path;
  if(!Array.isArray(path)||path.length<2){jarvisOriginalRouteSnapshot=null;jarvisOriginalRouteAnchorS=null;jarvisOriginalRouteRejoinFixes=0;return;}
  const pts=path.map(jarvisNormalizePathPoint).filter(Boolean);
  if(pts.length<2){jarvisOriginalRouteSnapshot=null;return;}
  const cum=[0];
  for(let i=1;i<pts.length;i++)cum[i]=cum[i-1]+haversine({latitude:pts[i-1].lat,longitude:pts[i-1].lng},{latitude:pts[i].lat,longitude:pts[i].lng});
  jarvisOriginalRouteSnapshot={route,pts,cum,total:cum[cum.length-1]};
  jarvisOriginalRouteAnchorS=null;
  jarvisOriginalRouteRejoinFixes=0;
}
function jarvisClearOriginalRouteSnapshot(){
  jarvisOriginalRouteSnapshot=null;jarvisOriginalRouteAnchorS=null;jarvisOriginalRouteRejoinFixes=0;
}
// Same jarvisCorridorMatch core as the active route, applied to the frozen original path instead.
function jarvisMatchOriginalRoute(lat,lon,speedKmh,accuracyM){
  const snap=jarvisOriginalRouteSnapshot;
  if(!snap)return null;
  const travel=jarvisTravelHeading();
  const acc=Number.isFinite(accuracyM)?accuracyM:Number(lastPos?.coords?.accuracy);
  const best=jarvisCorridorMatch(snap.pts,snap.cum,snap.total,lat,lon,jarvisOriginalRouteAnchorS,speedKmh,travel,acc);
  if(best)jarvisOriginalRouteAnchorS=best.s;
  return best;
}
// Rejoin policy (v6.14.54, integrating the road-test-v653.js concept natively): once a reroute
// has been accepted, a physical return to the ORIGINAL route is preferred over continuing the
// temporary reroute — it is what the rider actually re-encountered on the road. This goes through
// the same jarvisCommitRoute + jarvisRenderRoute + jarvisMotionAcceptFix path as any other route
// change, so no stale reroute geometry or generation/telemetry bookkeeping can survive it.
function jarvisRestoreOriginalRoute(reason,matchInfo){
  const snap=jarvisOriginalRouteSnapshot;
  if(!snap?.route||!navSessionStarted||typeof currentLat!=='number'||typeof currentLon!=='number')return false;
  jarvisCommitRoute([snap.route],0,{origin:{latitude:currentLat,longitude:currentLon},reason:'ORIGINAL_ROUTE_REJOIN'});
  jarvisPendingRouteRejoin=false;jarvisPendingRouteRejoinFixes=0;jarvisPendingRouteRejoinStartedAt=0;
  jarvisExitDeviationEscape();
  jarvisExitUTurnRecovery();
  jarvisResetAutoRerouteWatch();
  jarvisNavTrackingState='TRACKING';
  jarvisMotionReset();
  jarvisMotionAcceptFix(currentLat,currentLon,currentSpeedKmh,lastPos?.coords?.accuracy);
  jarvisResetVoiceProgress();
  jarvisRenderRoute();
  jarvisSetRouteGuidanceAppearance(true);
  jarvisClearTurnArrow?.();
  jarvisSetStatus('元のルートへ復帰：リルート線を破棄しました','ok');
  jarvisRoadTestNoteLifecycle('ORIGINAL_ROUTE_RESTORED',{reason,distance:matchInfo?.distance??null,generation:routeRequestSeq});
  jarvisOriginalRouteRejoinFixes=0;
  return true;
}

async function jarvisAutoReroute(strategy=null){
  if(autoRerouteBusy||!navSessionStarted||navMode!=='ROUTE'||!destination)return;
  const now=Date.now();
  if(now-autoRerouteLastAt<AUTO_REROUTE_COOLDOWN_MS)return;
  autoRerouteBusy=true;
  autoRerouteLastAt=now;
  jarvisNavTrackingState='REROUTING';
  jarvisResetAutoRerouteWatch();
  jarvisAutoDeviationCount++;
  jarvisSetStatus('現在地と進行方向からルートを再検索中…','warn');
  if(voiceGuideEnabled&&jarvisAutoDeviationCount===1)jarvisSpeak('ルートを再検索します',true);
  try{
    await jarvisComputeRoute(true,true,'HEADING');
  }finally{
    autoRerouteBusy=false;
  }
}
// v6.14.54: single consolidated off-route/reroute evidence engine. Previously this decision was
// made by up to three independently-tuned detectors layered as external runtime overlays
// (road-test-fixes.js's 6.5s post-reroute grace wrapper, road-test-v653.js's own accuracy-adaptive
// fast detector with its own reroute trigger) plus this original function underneath — each with
// different thresholds, each able to write jarvisNavTrackingState and independently call a
// reroute, with no shared evidence counters between them. That let one layer decide TRACKING while
// another, running immediately after on the same fix, decided OFF_ROUTE. There is now exactly one
// decision per fix, one set of counters, and one place that calls jarvisAutoReroute.
function jarvisAutoRerouteUpdate(coords,speedKmh){
  if(!navSessionStarted||navMode!=='ROUTE'||!routeData){
    jarvisNavTrackingState='TRACKING';
    jarvisResetAutoRerouteWatch();return;
  }
  if(jarvisNavTrackingState==='ARRIVED')return;

  const lat=Number(coords?.latitude),lon=Number(coords?.longitude),acc=Number(coords?.accuracy);
  const speed=Number(speedKmh)||0;

  // Physically returning to the route the rider started on takes priority over any other
  // decision below: it ends the detour outright instead of merely tolerating it.
  if(jarvisOriginalRouteSnapshot&&routeData!==jarvisOriginalRouteSnapshot.route&&Number.isFinite(lat)&&Number.isFinite(lon)){
    const os=jarvisMatchOriginalRoute(lat,lon,speed);
    const tight=Math.max(7,Math.min(11,(Number.isFinite(acc)?acc:12)*.55));
    const aligned=!!os&&os.distance<=tight&&(speed<5||jarvisHeadingMismatch(jarvisTravelHeading(),os.heading)<38);
    jarvisOriginalRouteRejoinFixes=aligned?jarvisOriginalRouteRejoinFixes+1:0;
    if(jarvisOriginalRouteRejoinFixes>=ORIGINAL_ROUTE_REJOIN_FIXES){
      jarvisRestoreOriginalRoute('PHYSICAL_REJOIN',os);
      return;
    }
  }

  if(!Number.isFinite(acc)||acc>AUTO_REROUTE_MAX_ACCURACY_M){
    jarvisNavTrackingState='UNCERTAIN';
    if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();
    return;
  }
  if(speed<2){
    if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();
    return;
  }

  // A route that just landed from a reroute needs a short settle window: ordinary GPS/heading
  // noise right after acceptance must not immediately look like a fresh departure from the NEW
  // route (previously a separate 6.5s wrapper around this whole function; now one flag this
  // function itself reads, set only by jarvisCommitRoute for an actual reroute/restore commit —
  // never by the first route computed at START, which has no prior deviation to settle from).
  const settling=Date.now()<jarvisRouteSettleUntil;

  const near=jarvisNearestActiveRoute(lat,lon,acc);
  if(!near)return;
  const moveHeading=Number.isFinite(currentHeading)?currentHeading:jarvisLastMovingHeading;
  const mismatch=jarvisHeadingMismatch(moveHeading,near.heading);
  const lateral=near.distance;

  // v6.14: U-turn is not a state machine anymore. If the vehicle keeps going, reroute
  // from the real position + heading rather than waiting for a return to the old route.
  if(jarvisUTurnRecovery)jarvisExitUTurnRecovery();

  // v6.14.13: a decisive course change is off-route evidence even while still close to the old
  // polyline at an intersection. v6.14.54: the lateral threshold is accuracy-adaptive (tighter
  // with good GPS, looser with weak GPS) instead of one fixed 20m value, so a confidently-good fix
  // can register a departure sooner than a noisy one — merged in from the fast-detector overlay
  // that was previously a separate, uncoordinated code path.
  const threshold=settling?Math.max(20,AUTO_REROUTE_DISTANCE_M):Math.max(12,Math.min(20,7+acc*.65));
  const headingWrong=speed>=6&&lateral>2&&mismatch>52;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(24,threshold+7);

  if(clearlyFar||headingWrong){
    if(!autoRerouteOffRouteSince)autoRerouteOffRouteSince=Date.now();
    autoRerouteOffRouteFixes++;
    jarvisDeviationEvidence+=hardFar?2:1;
    const held=Date.now()-autoRerouteOffRouteSince;

    // v6.14.55: a single noisy fix must not visibly flip the rider-facing state to OFF_ROUTE —
    // require the same 2-fix minimum the escape/reroute decisions below already use. Before that,
    // the state stays whatever it already was (very often just GPS noise that resolves on the
    // next fix); the counters above still accumulate so a genuine departure is not delayed.
    if(autoRerouteOffRouteFixes>=2)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?260:450;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=2&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    // Two readiness paths under one decision: fast (2 fixes + 550ms) for a decisively-far or
    // heading-wrong fix, steady (3 fixes + 1200ms) for borderline lateral evidence that isn't yet
    // decisive either way. Never active during the post-commit settle window.
    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=2&&held>=550;
    const steadyReady=autoRerouteOffRouteFixes>=AUTO_REROUTE_MIN_FIXES&&held>=AUTO_REROUTE_HOLD_MS;
    const rerouteReady=!settling&&(fastReady||steadyReady);

    if(jarvisDeviationEscape&&rerouteReady&&!autoRerouteBusy&&Date.now()-autoRerouteLastAt>=AUTO_REROUTE_COOLDOWN_MS)
      jarvisAutoReroute('HEADING');
    else if(jarvisDeviationEscape&&!autoRerouteBusy&&Date.now()-autoRerouteLastAt>=AUTO_REROUTE_RETRY_MS&&held>5000)
      jarvisAutoReroute('HEADING');
  }else if(lateral<8&&mismatch<35){
    jarvisNavTrackingState='TRACKING';
    if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();
  }else if(!jarvisDeviationEscape){
    // v6.14.55: ambiguous fix — neither clearly off nor clearly back on. Decay instead of
    // freezing the counter, so isolated noise cannot silently accumulate toward an escape/reroute
    // decision the way a genuine sustained departure does. Left alone once already escaping —
    // that decision has its own settle/cooldown handling above.
    if(autoRerouteOffRouteFixes>0){
      autoRerouteOffRouteFixes--;
      if(!autoRerouteOffRouteFixes)autoRerouteOffRouteSince=0;
    }
  }
}

async function jarvisComputeRoute(force=false,preserveNavigation=false,rerouteStrategy='NORMAL'){
  if(navMode!=='ROUTE'||!destination||typeof currentLat!=='number'||typeof currentLon!=='number'||!jarvisGoogleReady)return;
  // v6.4: v6.3のSTART固定を維持。走行中は自動再計算せず、再検索はREROUTE操作時だけ。
  if(navSessionStarted&&!force)return;
  const origin={latitude:currentLat,longitude:currentLon};
  const moved=routeLastOrigin?haversine(routeLastOrigin,origin):99999;
  if(!force && routeData && Date.now()-routeLastAt<30000 && moved<80)return;
  const seq=++routeRequestSeq;setTextIf('routeEta','ルート取得中…');jarvisSetStatus('道路ルート候補を計算中…');
  try{
    const {Route,TravelMode,RoutingPreference,PolylineQuality,TrafficModel}=await google.maps.importLibrary('routes');
    // Google Routes の TWO_WHEELER は日本未対応（2026-09時点）のため、日本では DRIVING を土台にする。
    const fastReroute=false;
    const travelHeading=(preserveNavigation&&Number.isFinite(jarvisTravelHeading()))?Math.round((jarvisTravelHeading()+360)%360):null;
    const originWaypoint=travelHeading===null?{lat:currentLat,lng:currentLon}:{lat:currentLat,lng:currentLon,heading:travelHeading};
    const req={
      origin:originWaypoint,
      destination:{lat:destination.lat,lng:destination.lon},
      travelMode:TravelMode?.DRIVING||'DRIVING',
      routingPreference:RoutingPreference?.TRAFFIC_AWARE_OPTIMAL||'TRAFFIC_AWARE_OPTIMAL',
      trafficModel:TrafficModel?.BEST_GUESS||'BEST_GUESS',
      computeAlternativeRoutes:true,
      intermediates:jarvisRequestIntermediates(rerouteStrategy),
      // ユーザー長押し経由地、または意思尊重リルート用の一時経由点を反映する。
      // 走行中の高ズームでも道路のカーブ・交差点形状に沿うよう、overviewではなく高精細な経路点列を取得する。
      polylineQuality:PolylineQuality?.HIGH_QUALITY||'HIGH_QUALITY',
      fields:['path','legs','distanceMeters','durationMillis','staticDurationMillis','routeLabels']
    };
    const out=await Route.computeRoutes(req);if(seq!==routeRequestSeq)return;
    // START後に古い検索結果が返ってきても、ナビ走行状態は絶対に解除しない。
    if(navSessionStarted&&!preserveNavigation)return;
    let routes=(out?.routes||[]).slice();
    if(!routes.length)throw new Error('ルート候補なし');
    // v6.14: for reroutes, score alternatives by current travel heading first, ETA second.
    // This specifically avoids divided-road routes that start by sending the rider backwards.
    if(preserveNavigation){
      const h=jarvisTravelHeading();
      routes.sort((a,b)=>jarvisRouteCandidateScore(a,h).score-jarvisRouteCandidateScore(b,h).score);
    }else{
      routes.sort((a,b)=>(Number(a.durationMillis)||Infinity)-(Number(b.durationMillis)||Infinity));
    }
    routes=routes.slice(0,3);
    // HIGH_QUALITYのRoute.pathを基準データにし、表示はRoute.createPolylines()を優先する。
    // これによりGoogle公式のルート描画処理をそのまま利用する。
    const cleanPath=(base)=>{
      const pts=[];
      for(const p of (base||[])){
        if(!p) continue;
        const lat=typeof p.lat==='function'?p.lat():Number(p.lat);
        const lng=typeof p.lng==='function'?p.lng():Number(p.lng);
        if(Number.isFinite(lat)&&Number.isFinite(lng)) pts.push({lat,lng});
      }
      return pts;
    };
    const newCandidates=routes.map(r=>{const rawPath=cleanPath(r.path),path=jarvisStabilizeRoutePath(rawPath);return{sourceRoute:r,rawPath,path,distanceMeters:Number(r.distanceMeters)||0,durationMillis:Number(r.durationMillis)||0,staticDurationMillis:Number(r.staticDurationMillis)||0,routeLabels:r.routeLabels||[]}});
    jarvisCommitRoute(newCandidates,0,{origin,reason:preserveNavigation?'REROUTE':'ROUTE_COMPUTED'});
    if(preserveNavigation){
      // Auto reroute: keep START state and immediately continue on the fastest new route.
      navSessionStarted=true;routePreviewActive=false;navMapFollow=true;navMapUserMoved=false;
      jarvisResetVoiceProgress();
    }else{
      navSessionStarted=false;routePreviewActive=true;
    }
    const km=jarvisRouteDistanceText(routeData);$('navDistance').textContent=km;setTextIf('landDistance',km);setTextIf('routeEta',jarvisRouteEtaText(routeData));
    jarvisRenderRouteChoices();jarvisRenderRoute();
    if(preserveNavigation){
      jarvisUpdateMapStartButton();
      const msg=rerouteStrategy==='REJOIN'?'元ルートへ戻るルートで案内継続':
                rerouteStrategy==='HEADING'?'進行方向を優先した新ルートで案内継続':'自動リルート完了';
      if(typeof currentLat==='number'&&typeof currentLon==='number'){
        jarvisMotionReset();
        const recovery=jarvisNewRouteRecoveryState(currentLat,currentLon,currentSpeedKmh);
        const chosenScore=jarvisRouteCandidateScore(routeData,jarvisTravelHeading());
        const p=jarvisNearestActiveRoute(currentLat,currentLon);
        // v6.14.12: route computation finishing is NOT the same as the rider rejoining it.
        // Keep FREE/GPS visual ownership and wait for 3 aligned fixes before snapping to
        // the new route. This removes the old-route/new-route tug-of-war during rerouting.
        if(p&&chosenScore.mismatch<95){
          jarvisDeviationEscape=true;
          jarvisVisualGpsPriority=true;
          jarvisPendingRouteRejoin=true;
          jarvisPendingRouteRejoinFixes=0;
          jarvisPendingRouteRejoinStartedAt=Date.now();
          // Never shorten the five-second GPS-only handoff just because Routes returned quickly.
          jarvisDeviationGpsIsolationUntil=Math.max(jarvisDeviationGpsIsolationUntil,jarvisDeviationStartedAt?jarvisDeviationStartedAt+5000:Date.now()+5000);
          jarvisNavTrackingState='REROUTING';
          jarvisRenderRoute();
          jarvisSetRouteGuidanceAppearance(true);
          jarvisClearTurnArrow?.();
          jarvisMotionStart();
          jarvisSetStatus(`新ルート取得：走行位置との合流を確認中… ${km}`,'warn');
        }else{
          // Never lock the rider into a U-turn. Keep following real GPS and retry from the
          // current heading if every returned route still starts behind the vehicle.
          jarvisDeviationEscape=true;
          jarvisVisualGpsPriority=true;
          jarvisPendingRouteRejoin=false;
          jarvisPendingRouteRejoinFixes=0;
          jarvisNavTrackingState='OFF_ROUTE';
          jarvisRenderRoute();
          jarvisSetRouteGuidanceAppearance(false);
          autoRerouteLastAt=Date.now()-AUTO_REROUTE_RETRY_MS;
          jarvisSetStatus('進行方向に合うルートを再検索します','warn');
        }
      }
    }else{
      jarvisScrollToMap();jarvisSetStatus(`${routeCandidates.length}ルート候補 / ${km} / ${jarvisRouteEtaText(routeData)}`,'ok');
      // route candidates are now visible, lower the sheet to the meter-only position automatically.
      setTimeout(()=>window.jarvisSheetSetState?.('collapsed',true),120);
    }
  }catch(e){
    if(seq!==routeRequestSeq)return;
    if(preserveNavigation){
      // Keep the existing running route on a transient network/API failure.
      jarvisEnterDeviationEscape('OFF_ROUTE');
      jarvisNavTrackingState='OFF_ROUTE';
      autoRerouteLastAt=Date.now()-AUTO_REROUTE_RETRY_MS;
      jarvisSetStatus('再検索失敗：目的地を保持し、現在位置から再試行します','warn');
      return;
    }
    routeData=null;routeCandidates=[];jarvisHideRouteLines();jarvisRenderRouteChoices();setTextIf('routeEta','ルート取得失敗');
    jarvisSetStatus('Routes取得エラー：'+(e?.message||e),'bad');
  }
}

function saveDestination(dest){
  destination=dest;
  routeViaPoints=[];localStorage.removeItem('jarvisRouteViaPoints');jarvisRenderViaMarkers();
  jarvisAutoDeviationCount=0;jarvisOriginalRoutePath=[];
  jarvisClearOriginalRouteSnapshot();
  localStorage.setItem('jarvisDestination',JSON.stringify(destination));
  setTextIf('navName',destination.name||'目的地');
  const st=$('googleStatus'); if(st) st.textContent=`設定完了：${destination.name||'目的地'}`;
  const rs=$('placeResults'); if(rs) rs.innerHTML='';
  updateNav();
  // Google Maps風：目的地を選んだら地図へ戻り、ROUTE候補を表示する。ADVENTUREへはいつでも切替可能。
  showTab('nav');
  navMode='ROUTE'; localStorage.setItem('jarvisNavMode','ROUTE'); jarvisUpdateNavModeButtons();
  routePreviewActive=true;navSessionStarted=false;jarvisUpdateMapStartButton();jarvisScrollToMap();
  setTimeout(()=>jarvisComputeRoute(true),180);
}

function restoreDestination(){
  try{
    const d=JSON.parse(localStorage.getItem('jarvisDestination')||'null');
    if(d&&isFinite(d.lat)&&isFinite(d.lon)){
      destination=d;
      setTextIf('navName',d.name||'目的地'); setTextIf('landName',d.name||'目的地');
      const st=$('googleStatus'); if(st) st.textContent=`前回の目的地：${d.name||'目的地'}`;
    }
  }catch(e){}
}

function clearDestination(){
  destination=null;
  localStorage.removeItem('jarvisDestination');
  setTextIf('navName','目的地未設定'); setTextIf('landName','目的地未設定');
  $('navDistance').textContent='-- km';
  setTextIf('navBearingText','目的地を検索してください');
  const st=$('googleStatus'); if(st) st.textContent='目的地をクリアしました';
  const rs=$('placeResults'); if(rs) rs.innerHTML='';
  jarvisClearRoute();
  jarvisSyncMaps();
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function searchDestination(){
  const q=$('searchInput').value.trim();
  if(!q){
    $('searchStatus').textContent='施設名・駅名・住所を入力してください';
    return;
  }

  if(searchAbort) searchAbort.abort();
  searchAbort=new AbortController();

  $('searchBtn').disabled=true;
  $('searchStatus').textContent='検索中…';
  $('searchResults').innerHTML='';

  try{
    const url='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=jp&accept-language=ja&q='+encodeURIComponent(q);
    const res=await fetch(url,{
      method:'GET',
      headers:{'Accept':'application/json'},
      signal:searchAbort.signal
    });
    if(!res.ok) throw new Error('検索サーバー '+res.status);
    const data=await res.json();

    if(!Array.isArray(data)||data.length===0){
      $('searchStatus').textContent='候補が見つかりませんでした。名称や住所を変えて検索してください。';
      $('searchResults').innerHTML='<div class="search-empty">検索結果なし</div>';
      return;
    }

    $('searchStatus').textContent=`${data.length}件の候補`;
    $('searchResults').innerHTML=data.map((r,i)=>{
      const full=r.display_name||'名称不明';
      const primary=(r.name||full.split(',')[0]||'目的地').trim();
      const sub=full;
      return `<button class="search-item" data-i="${i}">
        <span class="name">${escapeHtml(primary)}</span>
        <span class="sub">${escapeHtml(sub)}</span>
      </button>`;
    }).join('');

    [...$('searchResults').querySelectorAll('.search-item')].forEach(btn=>{
      btn.addEventListener('click',()=>{
        const r=data[Number(btn.dataset.i)];
        const lat=Number(r.lat),lon=Number(r.lon);
        if(!isFinite(lat)||!isFinite(lon)) return;
        const full=r.display_name||'目的地';
        const name=(r.name||full.split(',')[0]||'目的地').trim();
        saveDestination({lat,lon,name,displayName:full});
      });
    });

  }catch(e){
    if(e.name==='AbortError') return;
    $('searchStatus').textContent='検索できませんでした。通信状態を確認してください。';
    $('searchResults').innerHTML='<div class="search-empty">目的地検索エラー</div>';
  }finally{
    $('searchBtn').disabled=false;
  }
}



function showTab(which){
  const speed=which==='speed';
  $('speedPanel').classList.toggle('hidden',!speed);$('navPanel').classList.toggle('hidden',speed);
  $('speedTab')?.classList.toggle('active',speed);$('navTab')?.classList.toggle('active',!speed);
  document.body.classList.toggle('nav-mode',!speed);document.documentElement.classList.toggle('nav-mode',!speed);
  if(!speed){
    updateNav();
    // v6.14.7: 目的地検索やナビSTARTから独立して、NAVを開いた時点で連続位置追跡を開始する。
    // Google Navigation SDKのLocation Providerと同じく、位置更新をルート状態の下位レイヤーとして扱う。
    jarvisEnsureLocationTracking(false);
    requestWakeLock();
    // 非表示状態で初期化されたGoogle MapはiPhone Safariで中心がずれることがあるため、
    // NAV表示後にresize→現在地再取得→再センタリングする。
    setTimeout(()=>{jarvisResizeMaps();jarvisUpdateRecenterButton();if(!jarvisRoutePreviewOwnsViewport())jarvisAcquireAndRecenter(false)},120);
    setTimeout(()=>{jarvisResizeMaps();if(navMapFollow&&!jarvisRoutePreviewOwnsViewport())jarvisCenterOnCurrentPosition(false)},420);
  }else{
    jarvisStopLocationTrackingIfIdle();
    jarvisSyncWakeLock();
  }
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){
    enterResumeGuard();
    if(jarvisLocationTrackingWanted()){
      if(watchId!==null){navigator.geolocation.clearWatch(watchId);watchId=null}
      jarvisEnsureLocationTracking(false);
    }
    jarvisSyncWakeLock();
    // v6.14.54: background->foreground resync (route-line + GPS tracking) is already handled
    // above; also re-verify the route line itself didn't go stale while hidden.
    jarvisVerifyRouteRendered();
  }
});
window.addEventListener('pageshow',()=>{
  if(jarvisLocationTrackingWanted()){
    enterResumeGuard();
    jarvisEnsureLocationTracking(false);
    jarvisSyncWakeLock();
    jarvisVerifyRouteRendered();
  }
});

function bind(id,event,handler){
  const el=$(id);
  if(el) el.addEventListener(event,handler);
}
bind('startBtn','click',jarvisStartNavigation);
bind('mapStartBtn','click',jarvisStartNavigation);
bind('stopBtn','click',stopGPS);
bind('resetBtn','click',resetTrip);
bind('calcBtn','click',calcError);
bind('diagBtn','click',refreshDiagnostics);
bind('clearDestBtn','click',clearDestination);
bind('speedTab','click',()=>showTab('speed'));
bind('navTab','click',()=>showTab('nav'));
bind('speedToNavBtn','click',()=>showTab('nav'));
bind('recenterBtn','click',jarvisRecenterNav);
bind('headingModeBtn','click',jarvisToggleHeadingMode);
bind('adventureModeBtn','click',()=>jarvisSetNavMode('ADVENTURE'));
bind('routeModeBtn','click',()=>jarvisSetNavMode('ROUTE'));
jarvisUpdateNavModeButtons();
bind('themeModeBtn','click',jarvisToggleThemeMode);
bind('mapViewBtn','click',jarvisToggleMapView);
bind('landMapViewBtn','click',jarvisToggleMapView);
bind('voiceGuideBtn','click',jarvisToggleVolumePopup);
bind('mapVoiceVolume','input',e=>jarvisSetMapVoiceVolume(e.target.value));
bind('mapVoiceVolume','change',e=>jarvisSetMapVoiceVolume(e.target.value));
$('voiceVolumePopup')?.addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',jarvisCloseVolumePopup);
jarvisBindVoiceSettings();
bind('landThemeModeBtn','click',jarvisToggleThemeMode);
bind('landHeadingModeBtn','click',jarvisToggleHeadingMode);
jarvisUpdateVoiceButton();

try{
  const savedVia=JSON.parse(localStorage.getItem('jarvisRouteViaPoints')||'[]');
  if(Array.isArray(savedVia))routeViaPoints=savedVia.filter(p=>Number.isFinite(Number(p?.lat))&&Number.isFinite(Number(p?.lng))).map(p=>({lat:Number(p.lat),lng:Number(p.lng),visited:!!p.visited})).slice(0,3);
}catch(e){routeViaPoints=[]}
restoreDestination();
setTimeout(()=>jarvisRenderViaMarkers(),500);
refreshDiagnostics();
updateNav();
document.documentElement.dataset.jarvisReady='v6.14.16';



// ===== v6.13.10: iOS Safari input-focus cleanup =====
function jarvisBlurTextInputs(){
  try{
    const ae=document.activeElement;
    if(ae && typeof ae.blur==='function') ae.blur();
    document.querySelectorAll('input,textarea,[contenteditable="true"]').forEach(el=>{
      try{ if(el===document.activeElement || el.matches(':focus')) el.blur(); }catch(_){}
    });
    // Give iOS Safari a second chance after click/keyboard state settles.
    setTimeout(()=>{
      try{
        const ae2=document.activeElement;
        if(ae2 && typeof ae2.blur==='function') ae2.blur();
      }catch(_){}
    },80);
  }catch(_){}
}

// ===== v2.0 Google Places search =====
let jarvisGoogleReady = false;
let jarvisAutocomplete = null;
let jarvisSessionToken = null;
let jarvisDebounce = null;
const JARVIS_KEY_STORAGE = 'jarvisGoogleMapsApiKey';

function jarvisSetStatus(text, kind=''){
  const el = document.getElementById('googleStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'search-status' + (kind ? ' ' + kind : '');
}

// v6.14.47 HOSTING DIAGNOSTICS: a v6.14.46 ROAD TEST Claude Artifact publish showed only one
// generic message ("APIキー・サイト制限・Maps JavaScript APIを確認してください") for every
// possible failure — including the Artifact CSP itself blocking the maps.googleapis.com request
// outright, which is not fixable by re-entering a correct API key at all. jarvisHostDiag tells
// these apart so the rider (or whoever reads an exported session) is not sent chasing a key
// problem that was actually a hosting/CSP problem. Never records the API key itself — only
// location.origin (which host is actually running, useful for CSP/referrer troubleshooting) and
// fixed, key-free explanation text. See road-test/README.md and test/hosting-diagnostics-tests.mjs.
let jarvisHostDiag={
  mapsState:'UNKNOWN', // UNKNOWN -> LOADING -> MAPS_READY | MAPS_SCRIPT_BLOCKED_BY_CSP_OR_HOST | MAPS_AUTH_OR_KEY_ERROR
  mapsDetail:null,
  mapsOrigin:typeof location!=='undefined'?location.origin:null,
  geoState:'UNKNOWN' // UNKNOWN -> OK | GEOLOCATION_UNAVAILABLE | GEOLOCATION_PERMISSION_DENIED
};
function jarvisSetHostDiag(mapsState,mapsDetail){
  jarvisHostDiag.mapsState=mapsState;
  jarvisHostDiag.mapsDetail=mapsDetail||null;
  if(typeof jarvisRoadTestEnabled!=='undefined'&&jarvisRoadTestEnabled)jarvisRoadTestNoteLifecycle('MAPS_STATE_'+mapsState,{origin:jarvisHostDiag.mapsOrigin});
}
function jarvisSetGeoDiag(geoState){
  jarvisHostDiag.geoState=geoState;
  if(typeof jarvisRoadTestEnabled!=='undefined'&&jarvisRoadTestEnabled)jarvisRoadTestNoteLifecycle('GEO_STATE_'+geoState,{});
}

function jarvisLoadGoogle(key){
  if (!key) return;
  if (window.google && google.maps && google.maps.places) {
    jarvisInitPlaces();
    return;
  }
  if (document.getElementById('jarvisGoogleMapsScript')) return;
  jarvisSetHostDiag('LOADING',null);
  const s = document.createElement('script');
  s.id = 'jarvisGoogleMapsScript';
  s.async = true;
  s.defer = true;
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&v=beta&callback=jarvisGoogleCallback';
  // A network-level failure to even fetch the script — the CSP-blocked case a Claude Artifact
  // hits (maps.googleapis.com is not on the Artifact CSP's allowlist), but also a genuine DNS/
  // network failure on any host. Distinct from gm_authFailure below, which only fires once the
  // script DID load and execute but Google itself rejected the key/referrer.
  s.onerror = () => {
    jarvisSetHostDiag('MAPS_SCRIPT_BLOCKED_BY_CSP_OR_HOST',`スクリプト取得に失敗しました（オリジン: ${jarvisHostDiag.mapsOrigin}）。多くの場合ホスト側のCSP/ネットワーク制限が原因で、APIキーの正誤とは無関係です。`);
    jarvisSetStatus(`Google Mapsスクリプトを読み込めません（${jarvisHostDiag.mapsOrigin} のCSP/ネットワーク制限の可能性）。APIキーの問題ではない場合があります。`,'bad');
  };
  document.head.appendChild(s);
  jarvisSetStatus('Google Mapsに接続中…');
}

// Google's own documented global for Maps JS API authorization failures (invalid key, referrer/
// API restriction, billing not enabled) — called by the SDK itself after the script has already
// loaded and executed successfully, which is exactly what distinguishes this from s.onerror
// above (a network/CSP failure that never got this far at all).
window.gm_authFailure = function(){
  jarvisSetHostDiag('MAPS_AUTH_OR_KEY_ERROR',`Google Mapsが認証エラーを返しました（オリジン: ${jarvisHostDiag.mapsOrigin}）。APIキーの制限（HTTPリファラー/APIの有効化/請求設定）を確認してください。`);
  jarvisSetStatus('Google Maps認証エラー：APIキーのサイト制限・有効化・請求設定を確認してください。','bad');
};

window.jarvisGoogleCallback = function(){
  jarvisInitPlaces();
};

function jarvisInitPlaces(){
  try{
    jarvisGoogleReady = true;
    jarvisSessionToken = new google.maps.places.AutocompleteSessionToken();
    document.getElementById('keySetup')?.classList.add('hidden');
    jarvisSetStatus('Google検索 準備OK','ok');
    jarvisSetHostDiag('MAPS_READY',null);
    jarvisInitMaps();
  }catch(e){
    jarvisSetStatus('Placesライブラリ初期化エラー：' + e.message,'bad');
  }
}



function jarvisClearNearbyMarkers(){
  for(const m of [...navNearbyMarkers,...landNearbyMarkers]){try{m.setMap(null)}catch(e){}}
  navNearbyMarkers=[];landNearbyMarkers=[];
  try{navNearbyInfo?.close()}catch(e){} try{landNearbyInfo?.close()}catch(e){}
  navNearbyInfo=landNearbyInfo=null;
}
function jarvisNearbyIcon(label){
  const glyph=label==='コンビニ'?'C':label==='ガソリンスタンド'?'G':label==='トイレ'?'WC':label==='駐車場'?'P':label==='スーパー'?'S':label==='カフェ'?'☕':'●';
  return {path:google.maps.SymbolPath.CIRCLE,scale:15,fillColor:'#ffffff',fillOpacity:.96,strokeColor:'#111827',strokeWeight:2,labelOrigin:new google.maps.Point(0,0),_glyph:glyph};
}
async function jarvisOpenNearbyInfo(which,index){
  const item=nearbyPlaces[index]; if(!item)return;
  const map=which==='nav'?navGoogleMap:landGoogleMap;
  const markers=which==='nav'?navNearbyMarkers:landNearbyMarkers;
  const marker=markers[index]; if(!map||!marker)return;
  let info=which==='nav'?navNearbyInfo:landNearbyInfo;
  if(!info){info=new google.maps.InfoWindow(); if(which==='nav')navNearbyInfo=info;else landNearbyInfo=info;}
  const dist=item.distance<1000?Math.round(item.distance)+' m':(item.distance/1000).toFixed(1)+' km';
  const content=document.createElement('div');content.className='jarvis-place-popup';
  const media=document.createElement('div');media.className='jarvis-place-media hidden';content.appendChild(media);
  const title=document.createElement('strong');title.textContent=item.name;content.appendChild(title);
  const meta=document.createElement('div');meta.className='jarvis-place-meta';meta.textContent=`${dist} ・ ${item.address||''}`;content.appendChild(meta);
  const facts=document.createElement('div');facts.className='jarvis-place-facts';facts.textContent='店舗情報を取得中…';content.appendChild(facts);
  const set=document.createElement('button');set.type='button';set.textContent='目的地にする';
  set.addEventListener('click',()=>{saveDestination({name:item.name,lat:item.lat,lon:item.lon});jarvisSetStatus(`目的地SET：${item.name}`,'ok');info.close();updateNav();});
  content.appendChild(set); info.setContent(content); info.open({map,anchor:marker});
  map.panTo({lat:item.lat,lng:item.lon});
  if(!item.placeId){facts.textContent='';return;}
  try{
    const {Place}=await google.maps.importLibrary('places');
    const detail=new Place({id:item.placeId});
    await detail.fetchFields({fields:['photos','rating','userRatingCount','nationalPhoneNumber','websiteURI','googleMapsURI']});
    const lines=[];
    if(Number.isFinite(detail.rating)) lines.push(`★ ${detail.rating.toFixed(1)}${detail.userRatingCount?`（${detail.userRatingCount}件）`:''}`);
    if(detail.nationalPhoneNumber) lines.push(`☎ ${detail.nationalPhoneNumber}`);
    facts.textContent=lines.join(' ・ ') || '店舗情報あり';
    const links=document.createElement('div');links.className='jarvis-place-links';
    if(detail.websiteURI){const a=document.createElement('a');a.href=detail.websiteURI;a.target='_blank';a.rel='noopener';a.textContent='公式サイト';links.appendChild(a);}
    if(detail.googleMapsURI){const a=document.createElement('a');a.href=detail.googleMapsURI;a.target='_blank';a.rel='noopener';a.textContent='Googleマップ';links.appendChild(a);}
    if(links.childNodes.length) content.insertBefore(links,set);
    const photo=detail.photos?.[0];
    if(photo){
      const img=document.createElement('img');img.className='jarvis-place-photo';img.alt='';img.src=photo.getURI({maxWidth:420,maxHeight:220});media.appendChild(img);
      const attrs=photo.authorAttributions||[];
      if(attrs.length){const at=document.createElement('small');at.className='jarvis-photo-credit';at.append('写真: ');attrs.forEach((a,j)=>{if(j)at.append(', ');if(a.uri){const l=document.createElement('a');l.href=a.uri;l.target='_blank';l.rel='noopener';l.textContent=a.displayName||'Google user';at.appendChild(l);}else at.append(a.displayName||'Google user');});media.appendChild(at);}
      media.classList.remove('hidden');
    }
    info.setContent(content);
  }catch(e){facts.textContent='店舗詳細は取得できませんでした';console.warn('Place detail failed',e);}
}
function jarvisRenderNearbyMarkers(){
  jarvisClearNearbyMarkers(); if(!nearbyPlaces.length||!(window.google&&google.maps))return;
  const render=(map,which)=>{
    if(!map)return [];
    return nearbyPlaces.map((item,index)=>{
      const icon=jarvisNearbyIcon(item.label); const glyph=icon._glyph; delete icon._glyph;
      const marker=new google.maps.Marker({map,position:{lat:item.lat,lng:item.lon},title:item.name,icon,label:{text:glyph,color:'#111827',fontSize:glyph.length>1?'9px':'11px',fontWeight:'800'},zIndex:20});
      marker.addListener('click',()=>jarvisOpenNearbyInfo(which,index)); return marker;
    });
  };
  navNearbyMarkers=render(navGoogleMap,'nav'); landNearbyMarkers=render(landGoogleMap,'land');
  if(navGoogleMap&&typeof currentLat==='number'){
    const bounds=new google.maps.LatLngBounds();bounds.extend({lat:currentLat,lng:currentLon});nearbyPlaces.forEach(x=>bounds.extend({lat:x.lat,lng:x.lon}));
    navMapFollow=false;navMapUserMoved=true;navGoogleMap.fitBounds(bounds,64);jarvisUpdateRecenterButton();
  }
}
function jarvisNearbyCategory(q){
  const t=q.replace(/\s+/g,'');
  const isNear=/(近く|近所|周辺|近辺|最寄り)/.test(t);
  const defs=[
    {re:/(コンビニ|コンビニエンス)/,type:'convenience_store',label:'コンビニ'},
    {re:/(ガソリンスタンド|ガソリン|給油所|給油|サービスステーション|スタンド|\bGS\b)/i,type:'gas_station',label:'ガソリンスタンド'},
    {re:/(トイレ|便所|公衆トイレ)/,type:'public_bathroom',label:'トイレ'},
    {re:/(駐車場|パーキング)/,type:'parking',label:'駐車場'},
    {re:/(スーパー|スーパーマーケット)/,type:'supermarket',label:'スーパー'},
    {re:/(カフェ|喫茶店)/,type:'cafe',label:'カフェ'},
    {re:/(レストラン|飲食店|ご飯|ごはん)/,type:'restaurant',label:'レストラン'}
  ];
  const hit=defs.find(d=>d.re.test(t));
  return (hit && (isNear || t.length<=12)) ? hit : null;
}
async function jarvisSearchNearby(q,box){
  const cat=jarvisNearbyCategory(q);
  if(!cat) return false;
  if(typeof currentLat!=='number'||typeof currentLon!=='number'){
    jarvisSetStatus(`「近くの${cat.label}」は現在地が必要です。STARTでGPSを開始してください。`,'warn');
    return true;
  }
  try{
    const placesLib=await google.maps.importLibrary('places');
    const PlaceClass=placesLib.Place || google.maps.places.Place;
    const Rank=placesLib.SearchNearbyRankPreference || google.maps.places.SearchNearbyRankPreference;
    if(!PlaceClass?.searchNearby) return false;
    const request={
      fields:['id','displayName','formattedAddress','location'],
      locationRestriction:{center:{lat:currentLat,lng:currentLon},radius:5000},
      includedPrimaryTypes:[cat.type],
      maxResultCount:8,
      rankPreference:Rank?.DISTANCE || 'DISTANCE',
      language:'ja',
      region:'jp'
    };
    const {places}=await PlaceClass.searchNearby(request);
    if(!places?.length){jarvisSetStatus(`5km以内に${cat.label}が見つかりません。`,'warn');return true;}
    nearbyPlaces=[];
    jarvisSetStatus(`近い順に${places.length}件・地図にも表示`,'ok');
    for(const place of places){
      if(!place.location) continue;
      const btn=document.createElement('button');btn.className='place-result';
      btn.innerHTML='<strong></strong><span></span>';
      const name=place.displayName || cat.label;
      const loc=place.location;
      const plat=typeof loc.lat==='function'?loc.lat():loc.lat;
      const plng=typeof loc.lng==='function'?loc.lng():loc.lng;
      const dist=haversine({latitude:currentLat,longitude:currentLon},{latitude:plat,longitude:plng});
      btn.querySelector('strong').textContent=name;
      btn.querySelector('span').textContent=`${dist<1000?Math.round(dist)+' m':(dist/1000).toFixed(1)+' km'} ・ ${place.formattedAddress||''}`;
      const idx=nearbyPlaces.length;
      nearbyPlaces.push({name,lat:plat,lon:plng,address:place.formattedAddress||'',distance:dist,label:cat.label,placeId:place.id||''});
      btn.addEventListener('click',()=>{saveDestination({name,lat:plat,lon:plng});jarvisSetStatus(`目的地SET：${name}`,'ok');box.innerHTML='';updateNav();});
      box.appendChild(btn);
    }
    jarvisRenderNearbyMarkers();
    return true;
  }catch(e){
    console.warn('Nearby Search failed',e);
    jarvisSetStatus('周辺検索エラー：'+(e?.message||e),'bad');
    return true;
  }
}


function jarvisBoundsAround(lat,lon,radiusKm){
  const latDelta=radiusKm/111.32;
  const lonScale=Math.max(0.2,Math.cos(lat*Math.PI/180));
  const lonDelta=radiusKm/(111.32*lonScale);
  return {south:lat-latDelta,west:lon-lonDelta,north:lat+latDelta,east:lon+lonDelta};
}
function jarvisNormalizePlaceText(s){
  return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s　・･\-‐‑‒–—―ー_（）()\[\]【】「」『』]/g,'');
}
function jarvisPlaceRelevance(q,name,address=''){
  const nq=jarvisNormalizePlaceText(q), nn=jarvisNormalizePlaceText(name), na=jarvisNormalizePlaceText(address);
  if(!nq) return 0;
  if(nn===nq) return 1000;
  if(nn.startsWith(nq)) return 850;
  if(nn.includes(nq)) return 700;
  if(na.includes(nq)) return 420;
  // Google may return fuzzy matches; keep them as fallbacks but push them below literal matches.
  return 0;
}
async function jarvisSearchTextNearest(q,box){
  // v4.3: locationBias は「近くを優先」するだけで遠方候補を排除しない。
  // そこで現在地周辺を locationRestriction で段階的に限定し、営業中/状態不明のみを距離順表示する。
  if(typeof currentLat!=='number'||typeof currentLon!=='number') return false;
  try{
    const placesLib=await google.maps.importLibrary('places');
    const PlaceClass=placesLib.Place || google.maps.places.Place;
    const Rank=placesLib.SearchByTextRankPreference || google.maps.places.SearchByTextRankPreference;
    if(!PlaceClass?.searchByText) return false;
    let places=[]; let usedRadius=0;
    for(const radiusKm of [8,20,50]){
      const request={
        fields:['displayName','formattedAddress','location','businessStatus'],
        textQuery:q,
        locationRestriction:jarvisBoundsAround(currentLat,currentLon,radiusKm),
        rankPreference:Rank?.DISTANCE || 'DISTANCE',
        maxResultCount:20,
        language:'ja',
        region:'jp'
      };
      const out=await PlaceClass.searchByText(request);
      places=(out?.places||[]).filter(p=>String(p.businessStatus||'').toUpperCase()!=='CLOSED_PERMANENTLY');
      if(places.length){usedRadius=radiusKm;break;}
    }
    if(!places.length) return false;
    const items=[];
    for(const place of places){
      if(!place.location) continue;
      const loc=place.location;
      const lat=typeof loc.lat==='function'?loc.lat():loc.lat;
      const lon=typeof loc.lng==='function'?loc.lng():loc.lng;
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
      const distance=haversine({latitude:currentLat,longitude:currentLon},{latitude:lat,longitude:lon});
      const name=place.displayName||q, address=place.formattedAddress||'';
      const relevance=jarvisPlaceRelevance(q,name,address);
      items.push({place,lat,lon,distance,name,address,relevance});
    }
    if(!items.length) return false;
    items.sort((a,b)=>(b.relevance-a.relevance)||(a.distance-b.distance));
    jarvisSetStatus(`入力一致を優先・現在地${usedRadius}km圏で${Math.min(items.length,8)}件`,'ok');
    for(const item of items.slice(0,8)){
      const btn=document.createElement('button');btn.className='place-result';
      btn.innerHTML='<strong></strong><span></span>';
      btn.querySelector('strong').textContent=item.name;
      const d=item.distance<1000?`${Math.round(item.distance)}m`:`${(item.distance/1000).toFixed(1)}km`;
      btn.querySelector('span').textContent=`${d} · ${item.address}`;
      btn.addEventListener('click',()=>{
        saveDestination({name:item.name,lat:item.lat,lon:item.lon});
        jarvisSetStatus(`目的地SET：${item.name}`,'ok');
        box.innerHTML='';
        updateNav();
      });
      box.appendChild(btn);
    }
    return true;
  }catch(e){
    console.warn('Text Search nearest failed; fallback to autocomplete',e);
    return false;
  }
}

async function jarvisSetTypedDestination(){
  const input=document.getElementById('placeInput');
  const box=document.getElementById('placeResults');
  const q=input?.value.trim();
  if(!q || q.length<2){jarvisSetStatus('目的地名を2文字以上入力してください。','warn');return false;}
  if(!jarvisGoogleReady){jarvisSetStatus('Google検索の準備待ちです。','warn');return false;}
  try{
    jarvisSetStatus(`「${q}」を目的地として検索中…`);
    const placesLib=await google.maps.importLibrary('places');
    const PlaceClass=placesLib.Place || google.maps.places.Place;
    const Rank=placesLib.SearchByTextRankPreference || google.maps.places.SearchByTextRankPreference;
    if(!PlaceClass?.searchByText) throw new Error('Text Searchを利用できません');
    let candidates=[];
    const radii=(typeof currentLat==='number'&&typeof currentLon==='number')?[8,20,50]:[null];
    for(const radiusKm of radii){
      const request={
        fields:['displayName','formattedAddress','location','businessStatus'], textQuery:q,
        rankPreference:Rank?.RELEVANCE || 'RELEVANCE', maxResultCount:20, language:'ja', region:'jp'
      };
      if(radiusKm!=null) request.locationRestriction=jarvisBoundsAround(currentLat,currentLon,radiusKm);
      const out=await PlaceClass.searchByText(request);
      const places=(out?.places||[]).filter(p=>String(p.businessStatus||'').toUpperCase()!=='CLOSED_PERMANENTLY');
      for(const place of places){
        if(!place.location) continue;
        const loc=place.location;
        const lat=typeof loc.lat==='function'?loc.lat():Number(loc.lat);
        const lon=typeof loc.lng==='function'?loc.lng():Number(loc.lng);
        if(!Number.isFinite(lat)||!Number.isFinite(lon)) continue;
        const name=place.displayName||q, address=place.formattedAddress||'';
        const relevance=jarvisPlaceRelevance(q,name,address);
        const distance=(typeof currentLat==='number'&&typeof currentLon==='number')?haversine({latitude:currentLat,longitude:currentLon},{latitude:lat,longitude:lon}):Infinity;
        candidates.push({name,address,lat,lon,relevance,distance});
      }
      if(candidates.some(x=>x.relevance>=700)) break;
    }
    // Exact/name-containing matches outrank fuzzy nearby results. Distance breaks ties.
    candidates.sort((a,b)=>(b.relevance-a.relevance)||(a.distance-b.distance));
    const best=candidates[0];
    if(!best) throw new Error('候補が見つかりません');
    // Avoid silently choosing a fuzzy unrelated result (e.g. a clinic for 東大寺).
    if(best.relevance<420) throw new Error('入力名に一致する地点が見つかりません');
    saveDestination({name:best.name,lat:best.lat,lon:best.lon});
    jarvisSetStatus(`目的地SET：${best.name}`,'ok');
    if(box) box.innerHTML='';
    updateNav();
    return true;
  }catch(e){
    jarvisSetStatus('直接設定できません：'+e.message+'。候補から選んでください。','warn');
    await jarvisSearchPlaces();
    return false;
  }
}

async function jarvisSearchPlaces(){
  const input = document.getElementById('placeInput');
  const box = document.getElementById('placeResults');
  if (!input || !box) return;
  const q = input.value.trim();
  box.innerHTML = '';
  if (q.length < 2) {
    jarvisSetStatus(jarvisGoogleReady ? '2文字以上入力してください。' : 'Google検索の準備待ちです。');
    return;
  }
  if (!jarvisGoogleReady) {
    jarvisSetStatus('先にGoogle Maps APIキーを保存してください。','warn');
    return;
  }

  if(await jarvisSearchNearby(q,box)) return;
  nearbyPlaces=[]; jarvisClearNearbyMarkers();

  // 通常の店名/施設名は、まず現在地に近いText Search結果を表示。
  // 1件しかない場合もそこで終了せず、Autocompleteの関連候補を追加して選択肢を増やす。
  const hadNearest = await jarvisSearchTextNearest(q,box);

  try{
    // New Places Autocomplete Data API when available.
    if (google.maps.places.AutocompleteSuggestion) {
      const req = {
        input: q,
        sessionToken: jarvisSessionToken,
        includedRegionCodes: ['jp'],
        language: 'ja'
      };
      // Bias toward current GPS position without requiring it.
      if (typeof currentLat === 'number' && typeof currentLon === 'number') {
        req.locationBias = {center:{lat:currentLat,lng:currentLon}, radius:15000};
        req.origin = {lat:currentLat,lng:currentLon};
      }
      const {suggestions} = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
      if (suggestions?.length && typeof currentLat === 'number' && typeof currentLon === 'number') {
        suggestions.sort((a,b)=>{
          const da=Number(a?.placePrediction?.distanceMeters); const db=Number(b?.placePrediction?.distanceMeters);
          if(Number.isFinite(da)&&Number.isFinite(db)) return da-db;
          if(Number.isFinite(da)) return -1; if(Number.isFinite(db)) return 1; return 0;
        });
      }
      if (!suggestions || !suggestions.length) {
        if(!hadNearest) jarvisSetStatus('候補が見つかりません。住所を少し短くするか店名を変えて試してください。','warn');
        return;
      }
      jarvisSetStatus(`現在地優先で候補を表示中`,'ok');
      const renderedNames=new Set(Array.from(box.querySelectorAll('.place-result strong')).map(x=>(x.textContent||'').trim()));
      let added=0;
      for (const suggestion of suggestions) {
        if(box.querySelectorAll('.place-result').length>=8) break;
        const pred = suggestion.placePrediction;
        if (!pred) continue;
        const title = pred.mainText?.text || pred.text?.text || q;
        const fullText = pred.text?.text || `${title} ${pred.secondaryText?.text||''}`;
        // Text Searchで既に近距離候補がある時は、入力語を実際に含む候補だけ補足する。
        // 例: 「東大寺」→ 東大寺大仏殿/南大門/二月堂などは許可、無関係な池や店舗は除外。
        if(hadNearest){
          const nq=q.replace(/[\s　]+/g,'').toLowerCase();
          const nf=fullText.replace(/[\s　]+/g,'').toLowerCase();
          if(nq && !nf.includes(nq)) continue;
        }
        if(renderedNames.has(title.trim())) continue;
        renderedNames.add(title.trim());
        added++;
        const btn = document.createElement('button');
        btn.className = 'place-result';
        const dm=Number(pred.distanceMeters);
        const near=Number.isFinite(dm)?(dm<1000?`${Math.round(dm)}m`:`${(dm/1000).toFixed(1)}km`):'';
        const sub0 = pred.secondaryText?.text || pred.text?.text || '';
        const sub = near ? `${near} · ${sub0}` : sub0;
        btn.innerHTML = '<strong></strong><span></span>';
        btn.querySelector('strong').textContent = title;
        btn.querySelector('span').textContent = sub;
        btn.addEventListener('click', async () => {
          try{
            const place = pred.toPlace();
            await place.fetchFields({fields:['displayName','formattedAddress','location']});
            if (!place.location) throw new Error('座標を取得できません');
            const name = place.displayName || title;
            const loc=place.location;
            const lat=typeof loc.lat==='function'?loc.lat():Number(loc.lat);
            const lon=typeof loc.lng==='function'?loc.lng():Number(loc.lng);
            saveDestination({name,lat,lon});
            jarvisSetStatus(`目的地SET：${name}`,'ok');
            box.innerHTML = '';
            jarvisSessionToken = new google.maps.places.AutocompleteSessionToken();
            updateNav();
          }catch(e){ jarvisSetStatus('目的地取得エラー：'+e.message,'bad'); }
        });
        box.appendChild(btn);
      }
      return;
    }

    // Fallback for browsers/library versions exposing legacy AutocompleteService.
    const svc = new google.maps.places.AutocompleteService();
    svc.getPlacePredictions({
      input:q,
      componentRestrictions:{country:'jp'},
      sessionToken:jarvisSessionToken,
      ...(typeof currentLat==='number' && typeof currentLon==='number' ? {
        locationBias:{center:{lat:currentLat,lng:currentLon},radius:15000}, origin:new google.maps.LatLng(currentLat,currentLon)
      } : {})
    }, (preds,status)=>{
      if(status!==google.maps.places.PlacesServiceStatus.OK || !preds?.length){
        jarvisSetStatus('候補が見つかりません。','warn'); return;
      }
      jarvisSetStatus(`${preds.length}件の候補`);
      const dummy=document.createElement('div');
      const details=new google.maps.places.PlacesService(dummy);
      preds.slice(0,6).forEach(p=>{
        const btn=document.createElement('button'); btn.className='place-result';
        btn.innerHTML='<strong></strong><span></span>';
        btn.querySelector('strong').textContent=p.structured_formatting?.main_text||p.description;
        btn.querySelector('span').textContent=p.structured_formatting?.secondary_text||p.description;
        btn.onclick=()=>details.getDetails({placeId:p.place_id,fields:['name','geometry','formatted_address'],sessionToken:jarvisSessionToken},(pl,st)=>{
          if(st!==google.maps.places.PlacesServiceStatus.OK||!pl?.geometry?.location){jarvisSetStatus('目的地取得に失敗しました。','bad');return}
          saveDestination({name:pl.name||p.description,lat:pl.geometry.location.lat(),lon:pl.geometry.location.lng()});
          jarvisSetStatus(`目的地SET：${pl.name||p.description}`,'ok'); box.innerHTML='';
          jarvisSessionToken=new google.maps.places.AutocompleteSessionToken(); updateNav();
        });
        box.appendChild(btn);
      });
    });
  }catch(e){
    jarvisSetStatus('Google検索エラー：' + e.message,'bad');
  }
}

function jarvisBootV2(){
  // Remove old v1.5 Nominatim UI if any remnants exist.
  ['searchBtn','searchResults','searchStatus','destQuery'].forEach(id=>{
    const el=document.getElementById(id);
    if(el && !['googleStatus','placeResults'].includes(id)) el.style.display='none';
  });

  const saved = localStorage.getItem(JARVIS_KEY_STORAGE);
  if (saved) jarvisLoadGoogle(saved);

  document.getElementById('saveKeyBtn')?.addEventListener('click',()=>{
    const key=document.getElementById('apiKeyInput').value.trim();
    if(!key){jarvisSetStatus('APIキーを入力してください。','warn');return}
    localStorage.setItem(JARVIS_KEY_STORAGE,key);
    document.getElementById('apiKeyInput').value='';
    jarvisLoadGoogle(key);
  });

  document.getElementById('changeKeyBtn')?.addEventListener('click',()=>{
    localStorage.removeItem(JARVIS_KEY_STORAGE);
    document.getElementById('keySetup')?.classList.remove('hidden');
    jarvisSetStatus('新しいAPIキーを入力してください。');
    alert('保存済みキーを削除しました。新しいキーを入力して保存してください。');
  });

  document.getElementById('placeInput')?.addEventListener('input',()=>{
    clearTimeout(jarvisDebounce);
    jarvisDebounce=setTimeout(jarvisSearchPlaces,350);
  });
  document.getElementById('placeInput')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();clearTimeout(jarvisDebounce);jarvisSetTypedDestination();}
  });
  document.getElementById('setTypedDestBtn')?.addEventListener('click',()=>{
    clearTimeout(jarvisDebounce);
    jarvisSetTypedDestination();
  });
  document.getElementById('clearSearchBtn')?.addEventListener('click',()=>{
    document.getElementById('placeInput').value='';
    document.getElementById('placeResults').innerHTML='';
    jarvisSetStatus(jarvisGoogleReady?'Google検索 準備OK':'APIキーを保存するとGoogle検索を開始できます。');
  });
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',jarvisBootV2);
else jarvisBootV2();


// ===== v2.2 clock + weather (Open-Meteo, no API key) =====
let jarvisWeatherLastAt=0, jarvisWeatherLastLat=null, jarvisWeatherLastLon=null;
function jarvisUpdateClock(){
  const now=new Date();
  const t=document.getElementById('navClock'),d=document.getElementById('navDate');
  const ts=now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',hour12:false}); if(t) t.textContent=ts; setTextIf('landClock',ts);
  if(d) d.textContent=now.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric',weekday:'short'});
}
function jarvisWeatherLabel(code,isDay=1){
  if(code===0) return [isDay?'☀️':'🌙','快晴'];
  if(code===1) return [isDay?'🌤️':'🌙','晴れ'];
  if(code===2) return ['⛅','くもり時々晴れ'];
  if(code===3) return ['☁️','くもり'];
  if([45,48].includes(code)) return ['🌫️','霧'];
  if([51,53,55,56,57].includes(code)) return ['🌦️','霧雨'];
  if([61,63,65,66,67,80,81,82].includes(code)) return ['🌧️','雨'];
  if([71,73,75,77,85,86].includes(code)) return ['🌨️','雪'];
  if([95,96,99].includes(code)) return ['⛈️','雷雨'];
  return ['🌡️','天気'];
}
async function jarvisUpdateWeather(force=false){
  if(typeof currentLat!=='number'||typeof currentLon!=='number') return;
  const moved = jarvisWeatherLastLat===null ? 999 : haversine({latitude:jarvisWeatherLastLat,longitude:jarvisWeatherLastLon},{latitude:currentLat,longitude:currentLon});
  if(!force && Date.now()-jarvisWeatherLastAt<15*60*1000 && moved<10000) return;
  try{
    const url='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(currentLat)+'&longitude='+encodeURIComponent(currentLon)+'&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability&forecast_days=1&timezone=auto';
    const r=await fetch(url,{headers:{Accept:'application/json'}}); if(!r.ok) throw new Error(String(r.status));
    const j=await r.json(), cur=j.current||{};
    const newIsDay=Number(cur.is_day)===1;
    if(autoIsDay!==newIsDay){
      const before=jarvisEffectiveTheme(); autoIsDay=newIsDay; const after=jarvisEffectiveTheme();
      if(mapThemeMode==='AUTO'&&before!==after&&jarvisMapsReady) jarvisRebuildMaps();
    }else autoIsDay=newIsDay;
    const temp=document.getElementById('navTemp'),icon=document.getElementById('navWeatherIcon'),text=document.getElementById('navWeatherText'),rain=document.getElementById('navRain');
    if(temp && Number.isFinite(cur.temperature_2m)) temp.textContent=Math.round(cur.temperature_2m); if(Number.isFinite(cur.temperature_2m)) setTextIf('landTemp',Math.round(cur.temperature_2m));
    const pair=jarvisWeatherLabel(Number(cur.weather_code),Number(cur.is_day)); if(icon) icon.textContent=pair[0]; if(text) text.textContent=pair[1]; setTextIf('landWeatherIcon',pair[0]); setTextIf('landWeatherText',pair[1]);
    let pp=null;
    if(j.hourly?.time?.length && j.hourly?.precipitation_probability?.length){
      const now=Date.now(); let best=0,bestDiff=Infinity;
      j.hourly.time.forEach((x,i)=>{const diff=Math.abs(new Date(x).getTime()-now); if(diff<bestDiff){bestDiff=diff;best=i}});
      pp=j.hourly.precipitation_probability[best];
    }
    const rainText='降水 '+(Number.isFinite(pp)?Math.round(pp):'--')+'%'; if(rain) rain.textContent=rainText; setTextIf('landRain',rainText);
    jarvisWeatherLastAt=Date.now();jarvisWeatherLastLat=currentLat;jarvisWeatherLastLon=currentLon;
  }catch(e){ const text=document.getElementById('navWeatherText'); if(text) text.textContent='天気取得待ち'; setTextIf('landWeatherText','天気取得待ち'); }
}
jarvisUpdateClock();setInterval(jarvisUpdateClock,1000);


window.addEventListener('orientationchange',()=>setTimeout(jarvisResizeMaps,350));
window.addEventListener('resize',()=>setTimeout(jarvisResizeMaps,120));
document.getElementById('navTab')?.addEventListener('click',()=>setTimeout(jarvisResizeMaps,80));



// ===== v5.6 speed-meter bottom sheet =====
(function(){
  let sheet=null,handle=null,meter=null,startY=0,startOffset=0,currentOffset=0,dragging=false,lastTapSuppressed=false;
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function collapsedVisible(){
    // v5.6: collapsed state shows only the speed/weather card (+ grabber), never the mode/search rows.
    if(meter){
      const mh=Math.ceil(meter.getBoundingClientRect().height);
      return Math.min(212,Math.max(124,mh));
    }
    return window.matchMedia('(max-width:390px)').matches?138:142;
  }
  function offsets(){
    if(!sheet)return {collapsed:0,half:0,expanded:0};
    const h=sheet.getBoundingClientRect().height;
    const vh=window.innerHeight||document.documentElement.clientHeight;
    const cv=Math.min(h,collapsedVisible());
    const halfVisible=Math.min(h,Math.max(330,Math.round(vh*.52)));
    return {collapsed:Math.max(0,h-cv),half:Math.max(0,h-halfVisible),expanded:0};
  }
  function updateVisible(offset){
    if(!sheet)return;
    const h=sheet.getBoundingClientRect().height;
    const visible=clamp(h-offset,0,h);
    document.body.style.setProperty('--sheet-visible',Math.round(visible)+'px');
  }
  function applyOffset(offset,animate=true){
    if(!sheet)return;
    currentOffset=clamp(offset,0,sheet.getBoundingClientRect().height);
    sheet.classList.toggle('dragging',!animate);
    sheet.style.transform='translateY('+currentOffset+'px)';
    updateVisible(currentOffset);
  }
  function setState(state,animate=true){
    if(!sheet)return;
    const o=offsets(); if(!(state in o))state='collapsed';
    sheet.dataset.state=state; applyOffset(o[state],animate);
    if(state==='collapsed')sheet.scrollTop=0;
  }
  function nearestState(offset,velocity=0){
    const o=offsets();
    if(velocity<-0.45)return offset<=o.half?'expanded':'half';
    if(velocity>0.45)return offset>=o.half?'collapsed':'half';
    return Object.keys(o).sort((a,b)=>Math.abs(offset-o[a])-Math.abs(offset-o[b]))[0];
  }
  function bindDragSurface(el){
    if(!el)return;
    let lastY=0,lastT=0,velocity=0;
    el.addEventListener('pointerdown',e=>{
      if(!document.body.classList.contains('nav-mode'))return;
      dragging=true;lastTapSuppressed=false;startY=e.clientY;startOffset=currentOffset;lastY=e.clientY;lastT=performance.now();velocity=0;
      el.setPointerCapture?.(e.pointerId);sheet.classList.add('dragging');e.preventDefault();
    });
    el.addEventListener('pointermove',e=>{
      if(!dragging)return;const now=performance.now(),dt=Math.max(1,now-lastT);velocity=(e.clientY-lastY)/dt;lastY=e.clientY;lastT=now;
      if(Math.abs(e.clientY-startY)>6)lastTapSuppressed=true;
      applyOffset(startOffset+(e.clientY-startY),false);e.preventDefault();
    });
    const finish=()=>{if(!dragging)return;dragging=false;sheet.classList.remove('dragging');setState(nearestState(currentOffset,velocity),true);};
    el.addEventListener('pointerup',finish);el.addEventListener('pointercancel',finish);
  }
  function init(){
    sheet=document.getElementById('navBottomSheet');handle=document.getElementById('navSheetHandle');meter=document.querySelector('#navPanel .map-info-strip');
    if(!sheet||!handle||!meter)return;
    // Move the existing speed/weather frame into the top of the sheet.
    sheet.insertBefore(meter,handle.nextSibling);
    bindDragSurface(handle);bindDragSurface(meter);
    handle.addEventListener('click',()=>{if(lastTapSuppressed)return;const st=sheet.dataset.state||'collapsed';setState(st==='collapsed'?'half':st==='half'?'expanded':'collapsed');});
    handle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handle.click();}});
    meter.addEventListener('dblclick',()=>{const st=sheet.dataset.state||'collapsed';setState(st==='collapsed'?'half':'collapsed');});
    document.getElementById('placeInput')?.addEventListener('focus',()=>setState('expanded',true));
    document.getElementById('clearDestBtn')?.addEventListener('click',()=>setState('half',true));
    document.getElementById('mapStartBtn')?.addEventListener('click',()=>setTimeout(()=>setState('collapsed',true),80));
    window.addEventListener('resize',()=>setTimeout(()=>setState(sheet.dataset.state||'collapsed',false),120));
    window.jarvisSheetSetState=setState;
    requestAnimationFrame(()=>setState('collapsed',false));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();


function jarvisApplyVector3D(){
  const navMap=navGoogleMap;
  if(!navMap)return;
  try{
    const h=(headingUpMode?(jarvisTravelHeading()||0):0);
    navMap.setMapTypeId('roadmap');
    if(typeof navMap.setTilt==='function') navMap.setTilt(navSessionStarted?55:45);
    if(typeof navMap.setHeading==='function') navMap.setHeading(h);
    if(navSessionStarted){
      navMap.setZoom(19);
      if(Number.isFinite(currentLat)&&Number.isFinite(currentLon)){
        navMap.panTo({lat:currentLat,lng:currentLon});
      }
    }else{
      if((navMap.getZoom?.()||0)<18) navMap.setZoom(18);
    }
    setTextIf('map3dStatus','VECTOR 3D / '+(navSessionStarted?'走行追従':'閲覧')+' / '+(headingUpMode?'進行↑':'北↑'));
  }catch(e){
    setTextIf('map3dStatus','VECTOR 3D ERROR '+(e?.message||e));
  }
}


function jarvisResetVector3D(){
  if(!navMap)return;
  try{
    if(typeof navMap.setTilt==='function') navMap.setTilt(0);
    if(typeof navMap.setHeading==='function') navMap.setHeading(headingUpMode?(jarvisTravelHeading()||0):0);
  }catch(_){}
}


document.addEventListener('click',e=>{
  try{
    const b=e.target?.closest?.('button,[role="button"]');
    if(!b)return;
    const t=(b.textContent||'').trim().toUpperCase();
    if(t==='SET'||t==='START'||t.includes('START')) jarvisBlurTextInputs();
  }catch(_){}
},{capture:true});


setInterval(()=>{try{jarvisUpdateGuidanceDiagnostic()}catch(_){ }},1500);
