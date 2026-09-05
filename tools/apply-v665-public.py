from pathlib import Path
p=Path('app.js'); s=p.read_text()
old_wake="""function jarvisWakeWanted(){
  return document.visibilityState==='visible'&&(navSessionStarted||running);
}
"""
new_wake="""function jarvisWakeWanted(){
  // v6.14.65: desired wake state survives visibility transitions; acquisition remains visible-only.
  return !!(navSessionStarted||running);
}
"""
if old_wake not in s: raise SystemExit('wake block missing')
s=s.replace(old_wake,new_wake,1)
old_d="""  let d=(!navSessionStarted?jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):{lat:jarvisFreeMotion.targetLat,lng:jarvisFreeMotion.targetLon}),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);
"""
new_d="""  let d=(!navSessionStarted?jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):jarvisTrackingDisplayTargetV665(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon)),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);
"""
if old_d not in s: raise SystemExit('display target line missing')
s=s.replace(old_d,new_d,1)
anchor='function jarvisFreeMotionStart(){\n'
helper="""// v6.14.65 Google-style route adhesion for DISPLAY ONLY.
function jarvisTrackingDisplayTargetV665(lat,lng){
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisVisualGpsPriority||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};
  const acc=Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:15;
  const pr=jarvisMotionProject(lat,lng,acc);
  if(!pr||!Number.isFinite(pr.distance))return{lat,lng};
  const routeH=jarvisMotionHeadingAtS(pr.s),travel=jarvisTravelHeading();
  const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,routeH):0;
  if(Number(currentSpeedKmh)>=8&&mismatch>72)return{lat,lng};
  const maxSnap=Math.max(30,Math.min(58,28+acc*1.15));
  if(pr.distance>maxSnap)return{lat,lng};
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  let strength=pr.distance<=18?.985:pr.distance<=30?.94:pr.distance<=42?.82:.68;
  if(acc>28)strength=Math.min(strength,.80);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
}

"""
if anchor not in s: raise SystemExit('freeMotionStart missing')
s=s.replace(anchor,helper+anchor,1)
old_thresh="""  const threshold=settling?Math.max(20,AUTO_REROUTE_DISTANCE_M):Math.max(12,Math.min(20,7+acc*.65));
  const headingWrong=speed>=6&&lateral>2&&mismatch>52;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(24,threshold+7);
"""
new_thresh="""  const threshold=settling?Math.max(34,AUTO_REROUTE_DISTANCE_M):Math.max(24,Math.min(36,16+acc*.85));
  const headingWrong=speed>=8&&lateral>10&&mismatch>70;
  const clearlyFar=lateral>threshold;
  const hardFar=lateral>Math.max(44,threshold+10);
"""
if old_thresh not in s: raise SystemExit('reroute threshold block missing')
s=s.replace(old_thresh,new_thresh,1)
old_state="""    if(autoRerouteOffRouteFixes>=2)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?260:450;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=2&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    // Two readiness paths under one decision: fast (2 fixes + 550ms) for a decisively-far or
    // heading-wrong fix, steady (3 fixes + 1200ms) for borderline lateral evidence that isn't yet
    // decisive either way. Never active during the post-commit settle window.
    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=2&&held>=550;
    const steadyReady=autoRerouteOffRouteFixes>=AUTO_REROUTE_MIN_FIXES&&held>=AUTO_REROUTE_HOLD_MS;
"""
new_state="""    if(autoRerouteOffRouteFixes>=3)jarvisNavTrackingState='OFF_ROUTE';

    const escapeHold=headingWrong?1200:1600;
    if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=3&&held>=escapeHold)
      jarvisEnterDeviationEscape(headingWrong?'HEADING':'OFF_ROUTE');

    const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=4&&held>=2200;
    const steadyReady=autoRerouteOffRouteFixes>=5&&held>=3200;
"""
if old_state not in s: raise SystemExit('reroute state block missing')
s=s.replace(old_state,new_state,1)
s=s.replace("'v6.14.57-ROADTEST-dev'","'v6.14.65-ROADTEST-dev'").replace("'v6.14.58-ROADTEST-dev'","'v6.14.65-ROADTEST-dev'")
p.write_text(s)
i=Path('index.html'); t=i.read_text()
t=t.replace('JARVIS Road Test v6.14.58-ROADTEST-20260905T1530JST','JARVIS Road Test v6.14.65-ROADTEST-20260905T2320JST')
t=t.replace('JARVIS ROAD TEST v6.14.57-ROADTEST-20260904T222603Z','JARVIS ROAD TEST v6.14.65-ROADTEST-20260905T2320JST')
t=t.replace('window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.57-ROADTEST-20260904T222603Z";','window.__JARVIS_ROAD_TEST_BUILD_ID="v6.14.65-ROADTEST-20260905T2320JST";')
i.write_text(t)
