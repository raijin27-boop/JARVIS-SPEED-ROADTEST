(()=>{
'use strict';
function install(){
  if(typeof jarvisRenderRoute!=='function'||typeof jarvisAutoReroute!=='function'||typeof jarvisAutoRerouteUpdate!=='function'||typeof jarvisFreeAcceptFix!=='function'){
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
    if(jarvisPendingRouteRejoin)return;
    if(routeLastAt&&now-routeLastAt<6500&&jarvisDeviationEscape)return;
    if(jarvisNavTrackingState==='REROUTING'&&autoRerouteBusy)return;
    return originalAutoReroute.call(this,strategy);
  };

  const originalAutoRerouteUpdate=jarvisAutoRerouteUpdate;
  jarvisAutoRerouteUpdate=function(coords,speedKmh){
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
}
install();
})();