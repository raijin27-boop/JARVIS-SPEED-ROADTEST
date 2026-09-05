from pathlib import Path
import re
p=Path('app.js')
s=p.read_text()
# Add one continuous route-affinity state for the single display owner.
anchor="let jarvisVisualGpsPriorityStartedAt=0; // v6.14.79 smooth GPS visual handoff"
if anchor not in s: raise SystemExit('v79 display state anchor missing')
s=s.replace(anchor,anchor+"\nlet jarvisDisplayRouteWeight=1; // v6.14.80 unified display: 1=route, 0=live GPS",1)
# Replace the binary route/GPS display-target selector with continuous affinity blending.
pat=r"function jarvisTrackingDisplayTargetV665\(lat,lng\)\{.*?\n\}\n\nfunction jarvisFreeMotionStart\(\)\{"
m=re.search(pat,s,re.S)
if not m: raise SystemExit('display target function block missing')
new_func=r'''function jarvisTrackingDisplayTargetV665(lat,lng){
  if(!navSessionStarted||navMode!=='ROUTE'||!Number.isFinite(jarvisMotion.displayS)){
    jarvisDisplayRouteWeight=0;
    return{lat,lng};
  }
  const rp=jarvisMotionPointAtS(jarvisMotion.displayS);
  if(!rp){jarvisDisplayRouteWeight=0;return{lat,lng};}

  // v6.14.80 UNIFIED DISPLAY ARCHITECTURE
  // There is no longer a binary "route marker" -> "GPS marker" ownership switch.
  // The only rider-facing display target continuously blends the stabilized route-progress
  // pose with live accepted GPS. Raw GPS remains completely independent for OFF_ROUTE/reroute.
  // When the rider turns away, heading disagreement reduces route affinity before lateral error
  // grows, so the ball starts leaving the route immediately instead of freezing then teleporting.
  const acc=Math.max(3,Math.min(35,Number(jarvisFreeMotion.accuracy)||12));
  const speed=Math.max(0,Number(currentSpeedKmh)||0);
  const lateral=haversine({latitude:+lat,longitude:+lng},{latitude:rp.lat,longitude:rp.lng});
  const routeHeading=jarvisMotionHeadingAtS(jarvisMotion.displayS);
  const travel=jarvisTravelHeading();
  const mismatch=Number.isFinite(travel)?jarvisHeadingMismatch(travel,routeHeading):0;

  const latStart=Math.max(7,acc*.70),latEnd=Math.max(26,acc*2.0);
  const lateralDeparture=Math.max(0,Math.min(1,(lateral-latStart)/Math.max(8,latEnd-latStart)));
  const headingDeparture=speed>=7?Math.max(0,Math.min(1,(mismatch-26)/66)):0;
  let departure=Math.max(lateralDeparture,headingDeparture*.92);
  // visualGpsPriority is evidence that departure is real, but it no longer causes a hard switch.
  if(jarvisVisualGpsPriority)departure=Math.max(departure,.82);
  if(jarvisDeviationEscape||jarvisNavTrackingState==='OFF_ROUTE'||jarvisNavTrackingState==='REROUTING')departure=1;

  // Smoothstep gives high adhesion around the route while making release continuous.
  const sm=departure*departure*(3-2*departure);
  let wanted=1-sm;
  if(lateral<=Math.max(5,acc*.55)&&mismatch<24)wanted=1;
  if(jarvisDeviationEscape)wanted=0;

  // Release quickly when evidence rises; reacquire more cautiously when returning to the route.
  const k=wanted<jarvisDisplayRouteWeight ? .58 : .20;
  jarvisDisplayRouteWeight += (wanted-jarvisDisplayRouteWeight)*k;
  jarvisDisplayRouteWeight=Math.max(0,Math.min(1,jarvisDisplayRouteWeight));

  const w=jarvisDisplayRouteWeight;
  return{lat:rp.lat*w+(+lat)*(1-w),lng:rp.lng*w+(+lng)*(1-w)};
}

function jarvisFreeMotionStart(){'''
s=s[:m.start()]+new_func+s[m.end():]
# Disable the v74 second render owner. The free-motion engine is now the only marker owner.
old="const renderRouteLocked=!!(navSessionStarted&&navMode==='ROUTE'&&jarvisNavTrackingState==='TRACKING'&&!jarvisDeviationEscape&&!jarvisVisualGpsPriority&&Number.isFinite(jarvisMotion.displayS));"
if old not in s: raise SystemExit('v74 render lock line missing')
s=s.replace(old,"const renderRouteLocked=false; // v6.14.80 single display owner; route affinity is blended upstream",1)
# Reset route affinity at navigation/session reset boundaries where old progress is invalid.
s=s.replace("jarvisMotionReset();\n  $('speed').textContent='0'","jarvisMotionReset();jarvisDisplayRouteWeight=0;\n  $('speed').textContent='0'",1)
# v79 special handoff gain is no longer needed; keep one moderate continuous gain when route nav is active.
old_gain="""  }else if(jarvisVisualGpsPriority){
    // v6.14.79 SMOOTH VISUAL HANDOFF: v78 correctly bypassed stale route projection, but the
    // normal free-motion catch-up gain (.40 above 30m) then made a 30-50m visual teleport.
    // During visual-only departure, converge continuously from the last route-rendered position
    // toward live GPS before OFF_ROUTE takes over. This changes DISPLAY only, never reroute evidence.
    const visualMs=jarvisVisualGpsPriorityStartedAt?Date.now()-jarvisVisualGpsPriorityStartedAt:9999;
    if(visualMs<700)gain=acc<=15?.060:acc<=25?.052:.045;
    else if(visualMs<1500)gain=acc<=15?(dist>25?.095:.075):(dist>25?.080:.065);
    else gain=acc<=15?(dist>28?.14:.10):(dist>28?.12:.085);
  }else{
    gain=dist>30?.40:(dist>10?.24:.12);
  }
"""
new_gain="""  }else if(navSessionStarted&&navMode==='ROUTE'){
    // v6.14.80: one moderate continuous display response. No mode-change catch-up burst.
    gain=acc<=15?(dist>30?.14:(dist>10?.105:.075)):(dist>30?.12:(dist>10?.09:.065));
  }else{
    gain=dist>30?.40:(dist>10?.24:.12);
  }
"""
if old_gain not in s: raise SystemExit('v79 gain block missing')
s=s.replace(old_gain,new_gain,1)
s=s.replace("'v6.14.79-ROADTEST-dev'","'v6.14.80-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text().replace('v6.14.79-ROADTEST-20260906T0332JST','v6.14.80-ROADTEST-20260906T0350JST').replace('app.js?v=v6.14.79-0332','app.js?v=v6.14.80-0350').replace('road-test-ui.js?v=v6.14.79-0332','road-test-ui.js?v=v6.14.80-0350')
idx.write_text(t)
