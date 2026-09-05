from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""function jarvisTrackingDisplayTargetV665(lat,lng){
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};
  const acc=Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:15;
  const pr=jarvisMotionProject(lat,lng,acc);
  if(!pr||!Number.isFinite(pr.distance))return{lat,lng};
  // v6.14.72 SMOOTH ADHESION: keep a strong route bias, but do NOT teleport the display
  // directly onto each new 1 Hz GPS projection. The free-motion renderer below interpolates
  // continuously toward this target, eliminating the repeated rabbit-hop caused by v70/v71.
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return{lat,lng};
  let strength=pr.distance<=70?1:pr.distance<=100?.985:.95;
  if(acc>35)strength=Math.min(strength,.94);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
}
"""
new="""function jarvisTrackingDisplayTargetV665(lat,lng){
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')return{lat,lng};
  // v6.14.73 PROGRESS POSE: TRACKING display is derived from the already stabilized route
  // progress (displayS), NOT from re-projecting each discrete GPS target every animation frame.
  // jarvisMotionAcceptFix still projects the accepted GPS fix and independently feeds
  // off-route/reroute evidence; this changes only rider-facing marker position ownership.
  if(Number.isFinite(jarvisMotion.displayS)){
    const rp=jarvisMotionPointAtS(jarvisMotion.displayS);
    if(rp)return{lat:rp.lat,lng:rp.lng};
  }
  // Before the first stable route-progress fix exists, keep the free/GPS pose rather than
  // snapping to an arbitrary route segment. Once displayS initializes, route progress owns it.
  return{lat,lng};
}
"""
if old not in s: raise SystemExit('v72 display target block missing')
s=s.replace(old,new,1)
s=s.replace("'v6.14.72-ROADTEST-dev'","'v6.14.73-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.72-ROADTEST-20260906T0118JST','v6.14.73-ROADTEST-20260906T0130JST')
t=t.replace('app.js?v=v6.14.72-0118','app.js?v=v6.14.73-0130')
t=t.replace('road-test-ui.js?v=v6.14.72-0118','road-test-ui.js?v=v6.14.73-0130')
idx.write_text(t)
