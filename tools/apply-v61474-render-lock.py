from pathlib import Path
p=Path('app.js')
s=p.read_text()
old="""  // v6.14.72: never overwrite the interpolated display position with the newest route target.
  // The marker stays strongly route-biased but moves there continuously frame-by-frame.
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
"""
new="""  // v6.14.74 SAFE RENDER LOCK: v73 already made displayS continuous. While genuinely TRACKING,
  // render the rider directly from that continuous route-progress point, so the second lat/lng
  // low-pass above cannot cut inside bends or visibly trail beside the route. Crucially, DO NOT
  // write this route point back into jarvisFreeMotion: its GPS-smoothed state remains independent
  // and ready to take over immediately after confirmed OFF_ROUTE/REROUTING.
  const renderRouteLocked=!!(navSessionStarted&&navMode==='ROUTE'&&jarvisNavTrackingState==='TRACKING'&&!jarvisDeviationEscape&&!jarvisVisualGpsPriority&&Number.isFinite(jarvisMotion.displayS));
  const renderRoutePose=renderRouteLocked?jarvisMotionPointAtS(jarvisMotion.displayS):null;
  const renderLat=renderRoutePose?.lat ?? jarvisFreeMotion.displayLat;
  const renderLon=renderRoutePose?.lng ?? jarvisFreeMotion.displayLon;
  const mh=headingUpMode&&Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:0;
  navSquidOverlay?.setPosition(renderLat,renderLon,headingUpMode?0:(jarvisFreeMotion.displayHeading||0));
  if(now-jarvisFreeMotion.lastCameraAt>=70){
    jarvisFreeMotion.lastCameraAt=now;
    const camHeading=Number.isFinite(jarvisFreeMotion.displayHeading)?jarvisFreeMotion.displayHeading:(jarvisTravelHeading()||0);
    const displayZoom=(navSessionStarted&&navMode==='ROUTE')?jarvisAdaptiveNavZoom(jarvisCurrentGuidanceEvent()):18;
    const cc=jarvisCameraCenterAhead(renderLat,renderLon,camHeading,displayZoom);
    jarvisFollowCameraUpdate(cc.lat,cc.lng,camHeading,displayZoom,now,false);
  }
"""
if old not in s: raise SystemExit('v73 render block missing')
s=s.replace(old,new,1)
s=s.replace("'v6.14.73-ROADTEST-dev'","'v6.14.74-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text()
t=t.replace('v6.14.73-ROADTEST-20260906T0130JST','v6.14.74-ROADTEST-20260906T0150JST')
t=t.replace('app.js?v=v6.14.73-0130','app.js?v=v6.14.74-0150')
t=t.replace('road-test-ui.js?v=v6.14.73-0130','road-test-ui.js?v=v6.14.74-0150')
idx.write_text(t)
