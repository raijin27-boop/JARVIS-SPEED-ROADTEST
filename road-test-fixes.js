(()=>{
'use strict';
function install(){
  if(typeof jarvisRenderRoute!=='function'||typeof jarvisAutoReroute!=='function'||typeof jarvisAutoRerouteUpdate!=='function'||typeof jarvisFreeAcceptFix!=='function'||typeof jarvisArrivalUpdate!=='function'||typeof requestWakeLock!=='function'||typeof releaseWakeLock!=='function'){
    setTimeout(install,50);return;
  }

  const originalRenderRoute=jarvisRenderRoute;
  jarvisRenderRoute=function(){
    if(navSessionStarted&&navMode==='ROUTE'&&navGoogleMap){
      const r=(routeCandidates[selectedRouteIndex]||routeData);
      if(!r?.path?.length||r.path.length<2)return;
      const oldPrimary=navRouteLine;
      const oldLines=Array.isArray(navAltRouteLines)?navAltRouteLines.slice():[];
      let fresh=null;
      try{
        fresh=new google.maps.Polyline({map:navGoogleMap,path:r.path,strokeColor:'#238cff',strokeOpacity:jarvisDeviationEscape?.22:.98,strokeWeight:jarvisDeviationEscape?7:11,zIndex:20,clickable:false});
        const len=fresh.getPath?.().getLength?.()||0;
        if(len<2)throw new Error('replacement route path too short');
        navRouteLine=fresh;navAltRouteLines=[fresh];jarvisClearRouteLabels?.();
        for(const line of oldLines){if(line===fresh)continue;try{line?.setMap?.(null)}catch(e){}try{line?.remove?.()}catch(e){}}
        if(oldPrimary&&oldPrimary!==fresh&&!oldLines.includes(oldPrimary)){try{oldPrimary.setMap?.(null)}catch(e){}}
        if(landGoogleMap&&routeData?.path?.length){
          const previousLand=landRouteLine;let freshLand=null;
          try{
            freshLand=new google.maps.Polyline({map:landGoogleMap,path:routeData.path,strokeColor:'#238cff',strokeOpacity:.94,strokeWeight:10,zIndex:12});
            if((freshLand.getPath?.().getLength?.()||0)>=2){landRouteLine=freshLand;try{previousLand?.setMap?.(null)}catch(e){}}else freshLand.setMap?.(null);
          }catch(e){}
        }
        jarvisUpdateMapStartButton?.();if(mapViewMode==='3D')jarvisApplyVector3D?.();return;
      }catch(e){
        try{fresh?.setMap?.(null)}catch(_){}
        if(oldPrimary){navRouteLine=oldPrimary;navAltRouteLines=oldLines.length?oldLines:[oldPrimary];}
        return;
      }
    }
    return originalRenderRoute.apply(this,arguments);
  };

  const originalAutoReroute=jarvisAutoReroute;
  jarvisAutoReroute=async function(strategy=null){
    const now=Date.now();
    if(jarvisNavTrackingState==='ARRIVED')return;
    if(jarvisPendingRouteRejoin)return;
    if(routeLastAt&&now-routeLastAt<6500&&jarvisDeviationEscape)return;
    if(jarvisNavTrackingState==='REROUTING'&&autoRerouteBusy)return;
    return originalAutoReroute.call(this,strategy);
  };

  const originalAutoRerouteUpdate=jarvisAutoRerouteUpdate;
  jarvisAutoRerouteUpdate=function(coords,speedKmh){
    if(jarvisNavTrackingState==='ARRIVED')return;
    const now=Date.now();
    if(navSessionStarted&&navMode==='ROUTE'&&routeLastAt&&now-routeLastAt<6500){
      const lat=Number(coords?.latitude),lon=Number(coords?.longitude);
      const near=(Number.isFinite(lat)&&Number.isFinite(lon))?jarvisNearestActiveRoute(lat,lon):null;
      const moveHeading=Number.isFinite(currentHeading)?currentHeading:jarvisLastMovingHeading;
      const mismatch=near?jarvisHeadingMismatch(moveHeading,near.heading):Infinity;
      // During post-reroute alignment, don't re-enter OFF_ROUTE for ordinary GPS/heading settling.
      // A genuinely bad new route can still escape this grace if it is clearly far away or backwards.
      const clearlyWrong=!!near&&(near.distance>35||(Number(speedKmh)>=8&&mismatch>105));
      if(!clearlyWrong){
        jarvisResetAutoRerouteWatch();
        if(jarvisPendingRouteRejoin||jarvisDeviationEscape)jarvisNavTrackingState='REROUTING';
        else jarvisNavTrackingState='TRACKING';
        return;
      }
    }
    return originalAutoRerouteUpdate.call(this,coords,speedKmh);
  };

  const originalFreeAcceptFix=jarvisFreeAcceptFix;
  jarvisFreeAcceptFix=function(lat,lon,speedKmh,accuracyM){
    originalFreeAcceptFix.call(this,lat,lon,speedKmh,accuracyM);
    // Bound the estimator target distance from the visible vehicle pose. This prevents a backlog
    // of accepted GPS movement from being consumed as a 40-60m visible catch-up after reroute/CPU stalls.
    if(!Number.isFinite(jarvisFreeMotion.displayLat)||!Number.isFinite(jarvisFreeMotion.displayLon)||!Number.isFinite(jarvisFreeMotion.targetLat)||!Number.isFinite(jarvisFreeMotion.targetLon))return;
    const gap=haversine({latitude:jarvisFreeMotion.displayLat,longitude:jarvisFreeMotion.displayLon},{latitude:jarvisFreeMotion.targetLat,longitude:jarvisFreeMotion.targetLon});
    const maxGap=Math.max(16,Math.min(32,18+(Math.max(0,Number(speedKmh)||0)/3.6)*.9));
    if(gap<=maxGap)return;
    const hd=bearing(jarvisFreeMotion.displayLat,jarvisFreeMotion.displayLon,jarvisFreeMotion.targetLat,jarvisFreeMotion.targetLon);
    const capped=jarvisFreeForward(jarvisFreeMotion.displayLat,jarvisFreeMotion.displayLon,hd,maxGap);
    jarvisFreeMotion.targetLat=capped.lat;jarvisFreeMotion.targetLon=capped.lng;
  };

  // v6.14.49 ARRIVAL 20 m: the destination pin is authoritative. The base v6.14.44 arrival
  // accepts up to 45 m (or a 35 m route-end shortcut), so don't even call it until the real
  // vehicle is within 20 m. After its one-shot arrival voice/state work, clear the destination.
  const originalArrivalUpdate=jarvisArrivalUpdate;
  jarvisArrivalUpdate=function(){
    if(!navSessionStarted||navMode!=='ROUTE'||!destination||typeof currentLat!=='number'||typeof currentLon!=='number')return false;
    const pinDistance=haversine({latitude:currentLat,longitude:currentLon},{latitude:destination.lat,longitude:destination.lon});
    const accuracy=Number(lastPos?.coords?.accuracy);
    if(!Number.isFinite(pinDistance)||pinDistance>20)return false;
    // Ignore a clearly bad single fix near the destination. Normal iPhone GPS (<=40 m) is accepted.
    if(Number.isFinite(accuracy)&&accuracy>40)return false;
    const arrived=originalArrivalUpdate.apply(this,arguments);
    if(!arrived)return false;
    try{if(typeof jarvisRoadTestMarker==='function')jarvisRoadTestMarker('ARRIVAL_20M_ACCEPTED',{pinDistance:Number(pinDistance.toFixed(1)),accuracy:Number.isFinite(accuracy)?accuracy:null});}catch(e){}
    try{clearDestination();}catch(e){}
    // clearDestination -> jarvisClearRoute tears down the active session; keep ARRIVED latched so
    // late async reroute/update work cannot revive TRACKING.
    jarvisNavTrackingState='ARRIVED';
    try{jarvisSetStatus('目的地に到着しました。目的地を消去しました','ok');}catch(e){}
    return true;
  };

  // v6.14.49 SCREEN WAKE LOCK: iOS Safari/PWA may release a valid sentinel during lifecycle or
  // power-management transitions. Reacquire automatically while navigation/measurement still owns
  // the screen, with a single in-flight request and bounded retry to avoid API request storms.
  const originalRequestWakeLock=requestWakeLock;
  const originalReleaseWakeLock=releaseWakeLock;
  const guardedSentinels=new WeakSet();
  let wakeRequestInFlight=null;
  let wakeRetryTimer=null;
  let wakeRetryCount=0;
  let wakeExplicitRelease=false;
  let wakeSuppressUntil=0;

  function wakeWanted(){
    if(document.visibilityState!=='visible')return false;
    return !!(navSessionStarted||running);
  }
  function wakeMarker(kind,detail={}){
    try{if(typeof jarvisRoadTestMarker==='function')jarvisRoadTestMarker(kind,detail);else if(typeof jarvisRoadTestNoteLifecycle==='function')jarvisRoadTestNoteLifecycle(kind,detail);}catch(e){}
  }
  function armSentinel(){
    const sentinel=wakeLock;
    if(!sentinel||typeof sentinel.addEventListener!=='function'||guardedSentinels.has(sentinel))return;
    guardedSentinels.add(sentinel);
    sentinel.addEventListener('release',()=>{
      if(wakeExplicitRelease||Date.now()<wakeSuppressUntil||!wakeWanted())return;
      wakeMarker('WAKE_LOCK_RELEASED_UNEXPECTED',{});
      scheduleWake('sentinel-release');
    });
  }
  function scheduleWake(reason){
    if(!wakeWanted()||wakeLock||wakeRequestInFlight||wakeRetryTimer)return;
    const delay=Math.min(2000,250*Math.pow(2,Math.min(wakeRetryCount,3)));
    wakeMarker('WAKE_LOCK_REACQUIRE_ATTEMPT',{reason,delay,retry:wakeRetryCount});
    wakeRetryTimer=setTimeout(async()=>{
      wakeRetryTimer=null;
      await requestWakeLock();
      if(wakeLock){wakeRetryCount=0;wakeMarker('WAKE_LOCK_REACQUIRED',{reason});}
      else if(wakeWanted()){
        wakeRetryCount++;
        wakeMarker('WAKE_LOCK_REACQUIRE_FAILED',{reason,retry:wakeRetryCount});
        scheduleWake(reason);
      }
    },delay);
  }

  requestWakeLock=async function(){
    if(document.visibilityState!=='visible')return;
    if(wakeLock){armSentinel();return wakeLock;}
    if(wakeRequestInFlight)return wakeRequestInFlight;
    wakeRequestInFlight=(async()=>{
      try{await originalRequestWakeLock.apply(this,arguments);armSentinel();}
      finally{wakeRequestInFlight=null;}
      if(!wakeLock&&wakeWanted())scheduleWake('request-miss');
      return wakeLock;
    })();
    return wakeRequestInFlight;
  };

  releaseWakeLock=async function(){
    wakeExplicitRelease=true;wakeSuppressUntil=Date.now()+900;
    if(wakeRetryTimer){clearTimeout(wakeRetryTimer);wakeRetryTimer=null;}
    wakeRetryCount=0;
    try{return await originalReleaseWakeLock.apply(this,arguments);}
    finally{wakeExplicitRelease=false;}
  };

  // Base code releases if NAV view itself is not visible. For a started navigation session the
  // rider still expects the phone not to sleep, so active session/running owns Wake Lock globally.
  jarvisSyncWakeLock=async function(){
    if(document.visibilityState!=='visible')return;
    if(wakeWanted())await requestWakeLock();
    else await releaseWakeLock();
  };

  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&wakeWanted())scheduleWake('visibility-visible');});
  window.addEventListener('pageshow',()=>{if(wakeWanted())scheduleWake('pageshow');});
  window.addEventListener('focus',()=>{if(wakeWanted())scheduleWake('focus');});
  setInterval(()=>{if(wakeWanted()&&!wakeLock)scheduleWake('watchdog');},2500);
}
install();
})();