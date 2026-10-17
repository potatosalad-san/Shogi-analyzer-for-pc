const {contextBridge,ipcRenderer}=require('electron');
const inv=n=>(...a)=>ipcRenderer.invoke(n,...a);
contextBridge.exposeInMainWorld('nativeEngine',{
  list:inv('eng:list'),add:inv('eng:add'),rename:inv('eng:rename'),remove:inv('eng:remove'),select:inv('eng:select'),googleLogin:inv('auth:google'),start:inv('eng:start'),
  send:t=>ipcRenderer.send('eng:send',t),
  onLine:f=>{ipcRenderer.removeAllListeners('eng:line');ipcRenderer.on('eng:line',(_,l)=>f(l))}
});
