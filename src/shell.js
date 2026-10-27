import {legacyDestination} from './lib/navigation.js';
const destination=legacyDestination(location.href);if(destination)location.replace(destination);
const menu=document.getElementById('siteMenuButton'),nav=document.getElementById('siteNavigation');
function closeMenu(focus=true){nav?.classList.remove('is-open');menu?.setAttribute('aria-expanded','false');if(focus){menu?.focus();requestAnimationFrame(()=>{if(menu?.isConnected&&menu.getAttribute('aria-expanded')==='false')menu.focus()})}}
menu?.addEventListener('click',()=>{const on=menu.getAttribute('aria-expanded')!=='true';nav.classList.toggle('is-open',on);menu.setAttribute('aria-expanded',String(on))});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu?.getAttribute('aria-expanded')==='true'){e.preventDefault();closeMenu()}});
document.addEventListener('click',e=>{if(menu?.getAttribute('aria-expanded')==='true'&&!nav.contains(e.target)&&!menu.contains(e.target))closeMenu()});
matchMedia('(min-width:768px)').addEventListener('change',()=>closeMenu(false));
