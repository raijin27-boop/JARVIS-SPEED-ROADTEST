from pathlib import Path
p=Path('_site/app.js'); s=p.read_text()
helper=r'''
// ===== v6.14.55: tracking-only route snap =====
function jarvisTrackingSnapTarget(lat,lng){
  const raw={lat,lng};
  if(!navSessionStarted||navMode!=='ROUTE'||jarvisNavTrackingState!=='TRACKING'||jarvisDeviationEscape||jarvisVisualGpsPriority)return raw;
  const acc=Number.isFinite(jarvisFreeMotion.accuracy)?jarvisFreeMotion.accuracy:99;
  if(acc>40)return raw;
  const pr=jarvisMotionProject(lat,lng);if(!pr)return raw;
  const speed=Math.max(0,Number(currentSpeedKmh)||0);
  const routeH=jarvisMotionHeadingAtS(pr.s);
  const travel=Number.isFinite(jarvisFreeMotion.targetHeading)?jarvisFreeMotion.targetHeading:jarvisTravelHeading();
  const mismatch=(Number.isFinite(routeH)&&Number.isFinite(travel))?jarvisHeadingMismatch(travel,routeH):0;
  const snapLimit=Math.max(10,Math.min(26,8+acc*.70));
  if(pr.distance>snapLimit||(speed>=5&&mismatch>50))return raw;
  const rp=jarvisMotionPointAtS(pr.s);if(!rp)return raw;
  let strength=pr.distance<=8?.88:pr.distance<=15?.74:.58;
  if(acc>25)strength=Math.min(strength,.48);
  return{lat:lat+(rp.lat-lat)*strength,lng:lng+(rp.lng-lng)*strength};
}
'''
assert 'function jarvisTrackingSnapTarget(' not in s
s=s.replace('function jarvisFreeMotionStart(){',helper+'\nfunction jarvisFreeMotionStart(){',1)
old="let d=(!navSessionStarted?jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):{lat:jarvisFreeMotion.targetLat,lng:jarvisFreeMotion.targetLon}),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);"
new="let d=(navSessionStarted&&navMode==='ROUTE'?jarvisTrackingSnapTarget(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon):jarvisFreeCorridorTargetSafe(jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon)),age=Math.max(0,(now-jarvisFreeMotion.lastFixAt)/1000);"
assert old in s; s=s.replace(old,new,1)
state="let jarvisNavTrackingState='TRACKING'; // TRACKING / UNCERTAIN / OFF_ROUTE / REROUTING / ARRIVED"
assert state in s; s=s.replace(state,state+"\nlet jarvisOnRouteConfirmFixes=0;       // v6.14.55 hysteresis before clearing OFF_ROUTE",1)
old="function jarvisResetAutoRerouteWatch(){\n  autoRerouteOffRouteSince=0;\n  autoRerouteOffRouteFixes=0;\n  if(!jarvisDeviationEscape)jarvisDeviationEvidence=0;\n}"
new="function jarvisResetAutoRerouteWatch(){\n  autoRerouteOffRouteSince=0;\n  autoRerouteOffRouteFixes=0;\n  jarvisOnRouteConfirmFixes=0;\n  if(!jarvisDeviationEscape)jarvisDeviationEvidence=0;\n}"
assert old in s; s=s.replace(old,new,1)
old="const threshold=settling?Math.max(20,AUTO_REROUTE_DISTANCE_M):Math.max(12,Math.min(20,7+acc*.65));\n  const headingWrong=speed>=6&&lateral>2&&mismatch>52;"
new="const threshold=settling?Math.max(22,AUTO_REROUTE_DISTANCE_M):Math.max(14,Math.min(24,9+acc*.75));\n  const headingWrong=speed>=6&&lateral>Math.max(5,acc*.35)&&mismatch>58;"
assert old in s; s=s.replace(old,new,1)
old="if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=2&&held>=escapeHold)"
assert old in s; s=s.replace(old,"if(!jarvisDeviationEscape&&autoRerouteOffRouteFixes>=3&&held>=Math.max(700,escapeHold))",1)
old="const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=2&&held>=550;\n    const steadyReady=autoRerouteOffRouteFixes>=AUTO_REROUTE_MIN_FIXES&&held>=AUTO_REROUTE_HOLD_MS;"
new="const fastReady=(hardFar||headingWrong)&&autoRerouteOffRouteFixes>=3&&held>=900;\n    const steadyReady=autoRerouteOffRouteFixes>=Math.max(4,AUTO_REROUTE_MIN_FIXES)&&held>=Math.max(1600,AUTO_REROUTE_HOLD_MS);"
assert old in s; s=s.replace(old,new,1)
old="}else if(lateral<8&&mismatch<35){\n    jarvisNavTrackingState='TRACKING';\n    if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();\n  }"
new="}else if(lateral<9&&mismatch<38){\n    jarvisOnRouteConfirmFixes++;\n    if(jarvisNavTrackingState==='TRACKING'||jarvisOnRouteConfirmFixes>=2){\n      jarvisNavTrackingState='TRACKING';\n      if(!jarvisDeviationEscape)jarvisResetAutoRerouteWatch();\n    }\n  }else{\n    jarvisOnRouteConfirmFixes=0;\n  }"
assert old in s; s=s.replace(old,new,1)
for a,b in [("if(Math.abs(geom)<32)continue;","if(Math.abs(geom)<26)continue;"),("if(Math.abs(geom)<10||span.turnDeg<12)continue;","if(Math.abs(geom)<7||span.turnDeg<9)continue;"),("if(Math.abs(geom)<20||span.turnDeg<22)continue;","if(Math.abs(geom)<15||span.turnDeg<17)continue;"),("if(Math.abs(geom)<32||span.turnDeg<32)continue;","if(Math.abs(geom)<26||span.turnDeg<27)continue;")]:
    assert a in s; s=s.replace(a,b,1)
old="requestWakeLock().catch?.(()=>{});"; assert old in s; s=s.replace(old,"jarvisWakeVideoEnsure();\n    requestWakeLock().catch?.(()=>{});",1)
marker=r'''function jarvisUpdateVehicleBallState(){
  const div=navSquidOverlay?.div;if(!div)return;
  const warn=navSessionStarted&&jarvisNavTrackingState!=='TRACKING';
  div.classList.toggle('ball-warning',warn);
}
'''
assert 'function jarvisUpdateVehicleBallState(' not in s; s=s.replace('function onPosition(pos){',marker+'\nfunction onPosition(pos){',1)
old="lastPos={coords:{latitude:c.latitude,longitude:c.longitude},timestamp:pos.timestamp};\n  jarvisRoadTestRecordFix(c,sp);"; assert old in s; s=s.replace(old,"lastPos={coords:{latitude:c.latitude,longitude:c.longitude},timestamp:pos.timestamp};\n  jarvisUpdateVehicleBallState();\n  jarvisRoadTestRecordFix(c,sp);",1)
p.write_text(s)

c=Path('_site/app.css'); css=c.read_text(); assert 'v6.14.55 stable vehicle-ball state' not in css
css += r'''

/* ===== v6.14.55 stable vehicle-ball state ===== */
.map-squid-marker .earth-orb.blue-orb{background:radial-gradient(circle at 35% 28%,#8be5ff 0 12%,#239cff 35%,#0867d8 72%,#044a9e 100%)!important;}
.map-squid-marker .earth-orb.blue-orb::before{animation:none!important;opacity:.72!important;}
.map-squid-marker.ball-warning .earth-orb.blue-orb::before{width:42px!important;height:42px!important;background:radial-gradient(circle,rgba(255,187,66,0) 44%,rgba(255,187,66,.78) 55%,rgba(255,187,66,0) 74%)!important;opacity:1!important;}
'''
c.write_text(css)

idx=Path('_site/index.html'); html=idx.read_text(); assert 'CLAUDE-v6.14.54-EXPORT' in html; idx.write_text(html.replace('CLAUDE-v6.14.54-EXPORT','JARVIS-v6.14.55-ROADTEST'))
