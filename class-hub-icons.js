/* Fine-line SVG navigation icons, adapted from the icon set in l2practice/artwrite. */
(function(){
  var icons={
    '📅':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    '🗓':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/>',
    '📝':'<path d="M4 20l1.2-4.2L15 6a2 2 0 012.8 0l.2.2a2 2 0 010 2.8L8.2 18.8 4 20z"/><path d="M13.5 7.5l3 3"/>',
    '📖':'<path d="M4 5a1 1 0 011-1h5v16H5a1 1 0 01-1-1V5zM14 4h5a1 1 0 011 1v14a1 1 0 01-1 1h-5V4z"/>',
    '💳':'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
    '⭐':'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z"/>',
    '📊':'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    '⚙️':'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5v.1h-4v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.8.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3v-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.8l-.1-.1L7 4.3l.1.1a1.7 1.7 0 001.8.3 1.7 1.7 0 001-1.5v-.1h4v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 00-.3 1.8 1.7 1.7 0 001.5 1h.1v4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    '🚪':'<path d="M10 21H5a2 2 0 01-2-2V5a2 2 0 012-2h5M16 17l5-5-5-5M21 12H9"/>',
    '🏆':'<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a4 4 0 004 4M17 6h3v2a4 4 0 01-4 4"/>',
    '🗄':'<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    '🙋':'<circle cx="12" cy="7" r="3"/><path d="M6 21v-2a6 6 0 0112 0v2M19 4v7M16 7h6"/>',
    '📚':'<path d="M4 5a2 2 0 012-2h3v18H6a2 2 0 01-2-2V5zM13 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5V3z"/>',
    '✅':'<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    '📋':'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
    '🔄':'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0118 6l2 2M4 16l2 2a7 7 0 0012.4-3"/>',
    '✏️':'<path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3"/>',
    '🕒':'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    '🏠':'<path d="M3 10l9-7 9 7v10a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
    '🔍':'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'
  };
  function convert(root){
    (root||document).querySelectorAll('.nav-item>span,.ni-ico,.mnb .mi,.mnav-ico,.stat-icon,.mnav-more-item>span').forEach(function(el){
      var key=el.textContent.trim();if(!icons[key]||el.dataset.svgIcon)return;
      el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[key]+'</svg>';
      el.dataset.svgIcon='1';
    });
  }
  function start(){convert(document);new MutationObserver(function(records){records.forEach(function(r){r.addedNodes.forEach(function(n){if(n.nodeType===1)convert(n)})})}).observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
