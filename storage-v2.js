/* Athletik360 v2: IndexedDB persistence layer, no network dependency. */
const StorageV2 = (() => {
  const DB_NAME = 'athletik360_v2';
  const DB_VERSION = 1;
  let connection;
  function request(req) {return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB-Fehler'));});}
  function transaction(store, mode, handler) {
    return new Promise((resolve,reject)=>{
      const tx=connection.transaction(store,mode);
      let value;
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error||new Error('Speicherung fehlgeschlagen'));
      tx.onabort=()=>reject(tx.error||new Error('Speicherung abgebrochen'));
      try{value=handler(tx.objectStore(store));}catch(e){tx.abort();reject(e)}
    });
  }
  async function open(){
    if(connection)return connection;
    if(!('indexedDB' in window))throw new Error('IndexedDB ist in diesem Browser nicht verfügbar.');
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('data'))db.createObjectStore('data');
      if(!db.objectStoreNames.contains('snapshots'))db.createObjectStore('snapshots',{keyPath:'id'});
    };
    connection=await request(req);
    connection.onversionchange=()=>{connection.close();connection=null;};
    return connection;
  }
  async function get(key){await open();const tx=connection.transaction('data','readonly');return request(tx.objectStore('data').get(key));}
  async function put(key,value){await open();return transaction('data','readwrite',st=>st.put(value,key));}
  async function putMany(values){await open();return transaction('data','readwrite',st=>{for(const [key,value] of Object.entries(values))st.put(value,key);});}
  async function snapshot(reason,payload){
    await open();
    const id=new Date().toISOString()+'-'+Math.random().toString(36).slice(2,9);
    await transaction('snapshots','readwrite',st=>st.put({id,created:new Date().toISOString(),reason,payload}));
    return id;
  }
  async function migrateLegacy(){
    await open();
    const initialized=await get('initialized');
    if(initialized)return;
    const read=(key,fallback)=>{try{const v=localStorage.getItem(key);return v?JSON.parse(v):fallback;}catch{return fallback;}};
    const sessions=read('athletik2027_v1',[]);
    const markers=read('athletik360_healthmarkers_v1',[]);
    const draft=read('athletik360_draft_v13',null);
    const rest=read('athletik360_timer_v13',null);
    if(!Array.isArray(sessions)||!Array.isArray(markers))throw new Error('Alte Daten konnten nicht sicher geprüft werden.');
    const legacy={sessions,markers,draft,rest};
    await snapshot('migration-localStorage-v1',legacy);
    await putMany({initialized:true,sessions,markers,draft,rest,storageSchemaVersion:2,migratedAt:new Date().toISOString()});
    // Deliberately do not delete legacy localStorage keys: rollback remains possible.
  }
  async function dailySnapshot(sessions,markers){
    const date=new Date().toISOString().slice(0,10),previous=await get('lastDailySnapshot');
    if(previous===date)return;
    await snapshot('daily-'+date,{sessions,markers});
    await put('lastDailySnapshot',date);
  }
  async function listSnapshots(){await open();return request(connection.transaction('snapshots','readonly').objectStore('snapshots').getAll());}
  return {open,get,put,putMany,snapshot,migrateLegacy,dailySnapshot,listSnapshots};
})();
