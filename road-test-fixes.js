(()=>{
'use strict';
function install(){
  if(typeof jarvisRenderRoute!=='function'||typeof jarvisAutoReroute!=='function'){
    setTimeout(install,50);return;
  }

  const originalRenderRoute=jarvisRenderRoute;
  jarvisRenderRoute=function(){
    // Running navigation uses an atomic route-line swap: build the replacement first,
    // then remove the previous line only after the new Polyline is valid and attached.
    if(navSessionStarted&&navMode==='ROUTE'&&navGoogleMap){
      const r=(routeCandidates[selectedRouteIndex]||routeData);
      if(!r?.path?.length||r.path.length<2){
        // Never blank a still-valid old route because a transient reroute result is incomplete.
        return;
      }
      const oldPrimary=navRouteLine;
      const oldLines=Array.isArray(navAltRouteLines)?navAltRouteLines.slice():[];
      let fresh=null;
      try{
        fresh=new google.maps.Polyline({
          map:navGoogleMap,
          path:r.path,
          strokeColor:'#238cff',
          strokeOpacity:jarvisDeviationEscape?.22:.98,
          strokeWeight:jarvisDeviationEscape?7:11,
          zIndex:20,
          clickable:false
        });
        const len=fresh.getPath?.().getLength?.()||0;
        if(len<2)throw new Error('replacement route path too short');
        navRouteLine=fresh;
        navAltRouteLines=[fresh];
        jarvisClearRouteLabels?.();
        for(const line of oldLines){
          if(line===fresh)continue;
          try{line?.setMap?.(null)}catch(e){}
          try{line?.remove?.()}catch(e){}
        }
        if(oldPrimary&&oldPrimary!==fresh&&!oldLines.includes(oldPrimary)){
          try{oldPrimary.setMap?.(null)}catch(e){}
        }
        if(landGoogleMap&&routeData?.path?.length){
          const previousLand=landRouteLine;
          let freshLand=null;
          try{
            freshLand=new google.maps.Polyline({map:landGoogleMap,path:routeData.path,strokeColor:'#238cff',strokeOpacity:.94,strokeWeight:10,zIndex:12});
            if((freshLand.getPath?.().getLength?.()||0)>=2){landRouteLine=freshLand;try{previousLand?.setMap?.(null)}catch(e){}}
            else freshLand.setMap?.(null);
          }catch(e){}
        }
        jarvisUpdateMapStartButton?.();
        if(mapViewMode==='3D')jarvisApplyVector3D?.();
        return;
      }catch(e){
        try{fresh?.setMap?.(null)}catch(_){}
        // Keep the previous route visible when replacement creation fails.
        if(oldPrimary){navRouteLine=oldPrimary;navAltRouteLines=oldLines.length?oldLines:[oldPrimary];}
        return;
      }
    }
    return originalRenderRoute.apply(this,arguments);
  };

  const originalAutoReroute=jarvisAutoReroute;
  jarvisAutoReroute=async function(strategy=null){
    const now=Date.now();
    // A newly returned route needs time to be matched to the moving vehicle. Do not launch
    // another request while rejoin confirmation is pending, or immediately after route swap.
    if(jarvisPendingRouteRejoin)return;
    if(routeLastAt&&now-routeLastAt<6500&&jarvisDeviationEscape)return;
    if(jarvisNavTrackingState==='REROUTING'&&autoRerouteBusy)return;
    return originalAutoReroute.call(this,strategy);
  };
}
install();
})();