from pathlib import Path
p=Path('app.js')
s=p.read_text()
anchor="let jarvisVisualOnRouteFixes=0;"
if anchor not in s: raise SystemExit('visual anchor missing')
s=s.replace(anchor,anchor+"\nlet jarvisVisualGpsPriorityStartedAt=0; // v6.14.79 smooth GPS visual handoff",1)
old_set="""      jarvisVisualGpsPriority=true;
      jarvisVisualOnRouteFixes=0;
"""
new_set="""      if(!jarvisVisualGpsPriority)jarvisVisualGpsPriorityStartedAt=Date.now();
      jarvisVisualGpsPriority=true;
      jarvisVisualOnRouteFixes=0;
"""
# replace only first occurrence from early visual-release block
if old_set not in s: raise SystemExit('visual priority set block missing')
s=s.replace(old_set,new_set,1)
old_clear="""      jarvisVisualGpsPriority=false;
      jarvisVisualOnRouteFixes=0;
      jarvisResetAutoRerouteWatch();
"""
new_clear="""      jarvisVisualGpsPriority=false;
      jarvisVisualGpsPriorityStartedAt=0;
      jarvisVisualOnRouteFixes=0;
      jarvisResetAutoRerouteWatch();
"""
if old_clear not in s: raise SystemExit('visual clear block missing')
s=s.replace(old_clear,new_clear,1)
old_gain="""  }else{
    gain=dist>30?.40:(dist>10?.24:.12);
  }
"""
new_gain="""  }else if(jarvisVisualGpsPriority){
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
if old_gain not in s: raise SystemExit('normal gain block missing')
s=s.replace(old_gain,new_gain,1)
s=s.replace("'v6.14.78-ROADTEST-dev'","'v6.14.79-ROADTEST-dev'",1)
p.write_text(s)
idx=Path('index.html')
t=idx.read_text().replace('v6.14.78-ROADTEST-20260906T0325JST','v6.14.79-ROADTEST-20260906T0332JST').replace('app.js?v=v6.14.78-0325','app.js?v=v6.14.79-0332').replace('road-test-ui.js?v=v6.14.78-0325','road-test-ui.js?v=v6.14.79-0332')
idx.write_text(t)
