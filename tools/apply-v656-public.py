from pathlib import Path
p=Path('_site/app.js');s=p.read_text()
helper=r'''
// ===== v6.14.56: stronger route adhesion + longitudinal hop guard =====
function jarvisTrackingSnapTargetV656(lat,lng){
  const raw={lat,lng};
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisNavTrackingState!=='TRACKING'||jarvisDeviationEscape||jarvisVisualGpsPriority)return raw;
  const acc=Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:99;
  if(acc>45)return raw;
  const pr=jarvisMotionProject(lat,lng);if(!pr)return raw;
  const speed=Math.max(0,Number(currentSpeedKmh)||0);
  const routeH=jarvisMotionHeadingAtS(pr.s);
  const travel=Number.isFinite(jarvisFreeMotion.targetHeading)?jarvisFreeMotion.targetHeading:jarvisTravelHeading();
  const mismatch=(Number.isFinite(routeH)&&Number.isFinite(travel))?jarvisHeadingMismatch(travel,routeH):0;
  const snapLimit=Math.max(16,Math.min(38,12+acc*.85));
  if(pr.distance>snapLimit||(speed>=7&&mismatch>62))return raw;
  let snapS=pr.s;
  const anchor=Number.isFinite(jarvisMotion.displayS)?jarvisMotion.displayS:pr.s;
  const maxForward=Math.max(28,18+(speed/3.6)*2.2),maxBackward=12;
  if(snapS>anchor+maxForward)snapS=anchor+maxForward;
  if(snapS<anchor-maxBackward)snapS=anchor-maxBackward;
  const rp=jarvisMotionPointAtS(Math.max(0,Math.min(jarvisMotion.total,snapS)));if(!rp)return raw;
  let strength=pr.distance<=12?1:pr.distance<=22?.92:.76;
  if(acc>28)strength=Math.min(strength,.62);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
}
function jarvisChooseRerouteCandidateV656(candidates,fallbackIndex=0){
  if(!Array.isArray(candidates)||candidates.length<2)return fallbackIndex||0;
  const hd=Number.isFinite(jarvisLastMovingHeading)?jarvisLastMovingHeading:jarvisTravelHeading();
  if(!Number.isFinite(hd))return fallbackIndex||0;
  let best=fallbackIndex||0,bestScore=Infinity;
  candidates.forEach((r,i)=>{const pts=r?.path||[];if(pts.length<2)return;const p0=pts[0];let j=1,dist=0;while(j<pts.length){dist+=haversine({latitude:Number(p0.lat),longitude:Number(p0.lng)},{latitude:Number(pts[j].lat),longitude:Number(pts[j].lng)});if(dist>=35)break;j++;}const pj=pts[Math.min(j,pts.length-1)],rh=bearing(Number(p0.lat),Number(p0.lng),Number(pj.lat),Number(pj.lng)),mm=jarvisHeadingMismatch(hd,rh),dur=Math.max(0,Number(r.durationMillis)||0)/60000,meters=Math.max(0,Number(r.distanceMeters)||0);let score=mm*1.7+dur*.8+meters/1800;if(mm>115)score+=90;if(score<bestScore){bestScore=score;best=i;}});return best;
}
let jarvisWakeGuardianTimer=null;
function jarvisWakeGuardianV656(){if(jarvisWakeGuardianTimer)return;const pulse=()=>{jarvisWakeGuardianTimer=null;if(!jarvisWakeWanted())return;try{jarvisWakeVideoEnsure();}catch(e){}if(document.visibilityState==='visible'&&!wakeLock&&!jarvisWakeRequestInFlight){try{requestWakeLock().catch?.(()=>{});}catch(e){}}jarvisWakeGuardianTimer=setTimeout(pulse,12000);};pulse();}
'''
assert 'function jarvisTrackingSnapTargetV656(' not in s
s=s.replace('function jarvisFreeMotionStart(){',helper+'\nfunction jarvisFreeMotionStart(){',1)
old="let d=(navSessionStarted&&navMode==='ROUTE'?jarvisTrackingSnapTarget(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon)),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);";assert old in s;s=s.replace(old,"let d=(navSessionStarted&&navMode==='ROUTE'?jarvisTrackingSnapTargetV656(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon)),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);",1)
old="function jarvisWakeWanted(){\n  return document.visibilityState==='visible'&&(navSessionStarted||running);\n}";assert old in s;s=s.replace(old,"function jarvisWakeWanted(){\n  return !!(navSessionStarted||running);\n}",1)
old="function jarvisStartNavigation(){\n  jarvisArrivalResetBusy=false;";assert old in s;s=s.replace(old,"function jarvisStartNavigation(){\n  jarvisArrivalResetBusy=false;\n  jarvisWakeGuardianV656();",1)
old="function jarvisCommitRoute(candidates,selectedIndex,meta={}){\n  const{origin=null,reason='ROUTE_COMMITTED'}=meta;\n  routeCandidates=candidates;\n  selectedRouteIndex=Math.max(0,Math.min(candidates.length-1,selectedIndex||0));";assert old in s;s=s.replace(old,"function jarvisCommitRoute(candidates,selectedIndex,meta={}){\n  const{origin=null,reason='ROUTE_COMMITTED'}=meta;\n  routeCandidates=candidates;\n  if(reason==='REROUTE')selectedIndex=jarvisChooseRerouteCandidateV656(candidates,selectedIndex||0);\n  selectedRouteIndex=Math.max(0,Math.min(candidates.length-1,selectedIndex||0));",1)
old="const pts=[],s0=win.startS,s1=win.endS;";assert old in s;s=s.replace(old,"let s0=win.startS,s1=win.endS;\n const maxWhiteSpan=win.branch?52:38;\n if(s1-s0>maxWhiteSpan){const mid=Math.max(s0,Math.min(s1,turn.startS));s0=Math.max(s0,mid-maxWhiteSpan*.42);s1=Math.min(s1,s0+maxWhiteSpan);}\n const pts=[];",1)
p.write_text(s)
idx=Path('_site/index.html');html=idx.read_text();assert 'JARVIS-v6.14.55-ROADTEST' in html;idx.write_text(html.replace('JARVIS-v6.14.55-ROADTEST','JARVIS-v6.14.56-ROADTEST'))
