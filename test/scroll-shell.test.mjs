import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('only Cases opts into the viewport shell; content pages need no scrolling overrides',()=>{
  const css=fs.readFileSync('dist/style.css','utf8');
  assert.match(css,/html,body,main\{margin:0;width:100%\}/);
  assert.match(css,/html\.app-shell,html\.app-shell body,html\.app-shell main\{height:100%;overflow:hidden\}/);
  for(const page of ['site-cases','app','site-overview','about','site-daily','examples']){
    const html=fs.readFileSync(`dist/${page}.html`,'utf8');
    assert.equal(/<html[^>]*class="app-shell"/.test(html),page==='site-cases'||page==='app',page);
    assert.doesNotMatch(html,/html,body[^{}]*\{[^}]*overflow:/,page);
  }
});
