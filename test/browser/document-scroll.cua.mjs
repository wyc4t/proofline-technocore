// Run with a CUA Tab in the Codex browser runtime, after choosing the viewport.
// Uses real wheel/keyboard input; DOM evaluation only observes state.
export async function checkDocumentScroll(tab,{baseUrl,route,input}){
  await tab.goto(baseUrl+route);
  await tab.playwright.waitForLoadState({state:'load'});
  await tab.getAXState({emit:false});
  const rootOverflow=await tab.playwright.evaluate(()=>getComputedStyle(document.documentElement).overflowY);
  if(rootOverflow==='hidden')throw Error(`${route}: root overflow is hidden`);
  if(route==='/about'){
    while(await tab.playwright.locator('details:not([open]) > summary').count())await tab.playwright.locator('details:not([open]) > summary').first().click();
    await tab.getAXState({emit:false});
  }
  const viewport=await tab.playwright.evaluate(()=>({width:innerWidth,height:innerHeight}));
  await tab.scroll([viewport.width-30,Math.round(viewport.height*.65)],'up',60);
  await tab.getAXState({emit:false});
  const observe=()=>tab.playwright.evaluate(()=>({scrollY,height:document.documentElement.scrollHeight,viewport:[innerWidth,innerHeight],footer:document.querySelector('footer').getBoundingClientRect().toJSON()}));
  const start=await observe();
  const visible=s=>s.footer.top>=0&&s.footer.bottom<=s.viewport[1]+1;
  let end=start,steps=0;
  while(!visible(end)&&steps<60){
    if(input==='keyboard')await tab.pressKey(null,'Page_Down');
    else await tab.scroll([end.viewport[0]-30,Math.round(end.viewport[1]*.65)],'down',1);
    await tab.getAXState({emit:false});
    end=await observe();steps++;
  }
  if(!visible(end))throw Error(`${route} ${input}: footer not reached after ${steps} inputs; scrollY=${end.scrollY}`);
  if(start.height>start.viewport[1]&&end.scrollY<=0)throw Error(`${route} ${input}: document did not scroll`);
  return {route,input,rootOverflow,steps,start,end};
}
