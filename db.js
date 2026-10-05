// EduPortal data layer — generated from Code.gs + model.js + core.js. Edit those, not this file.
(function(){
"use strict";
// ── CONFIG: paste the firebaseConfig object from Firebase console → Project settings → Your apps.
// It is meant to be public; access is controlled by the Firestore rules.
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyB6rgwkLoaHGxfrJCZ8atH4XuMp3SaFlOI",
  authDomain: "class-portal-d6640.firebaseapp.com",
  projectId: "class-portal-d6640",
  storageBucket: "class-portal-d6640.firebasestorage.app",
  messagingSenderId: "355593062123",
  appId: "1:355593062123:web:c26ee4f0804a3c5a8de0ae"
};

// ================================================================
// DATA MODEL — Sheets tables  ⇄  Firestore documents
// Shared verbatim by Code.gs (migration, backup export) and db.js (browser).
// Relies on a global fmtDate(v) → 'yyyy-MM-dd'.
//
// students/{lowercased email}
//   email       original Email string (joins stay exact, as in the Sheet)
//   status      'active' (Users) | 'archived' (Archived_Users) | 'orphan' (data only, no user row)
//   ord         row order, keeps every table in its original order
//   u           profile: FullName, DOB, Phone, Class, Role, StudentID (+ any extra column). Never the password.
//   archivedDate
//   hwKey       prefix of this student's Homework_Master columns (email with @ and . → _)
//   att         { classId: { 'yyyy-MM-dd': { dl, st, sc, d0 } } }   ← Attendance_Master
//   hw          { hwId: { st, gd, nt } }                              ← <hwKey>_Status/_GradedDate/_Note
//   pay         { classId: { monthNo: { d, n } } }                    ← Tuition_Payments
//   cls         id of the class doc of u.Class — the only class doc this student may read
//   rk          own ranking for the latest month, written by the worker (never classmates' data)
// classes/{class name}
//   status      'active' (has a tab) | 'archived' (ARCHIVED_ tab) | 'hidden' (homework rows only)
//   ord         sheet order
//   sched       [{ v: [A..G] }] class tab incl. header row (source of truth stays the Sheet tab)
//   hw          { hwId: { sd, dl, t, ct, dd, by, ord } }             ← Homework_Master base columns
//   hwm         { monthNo: endedDate }                                ← HW_Month_Status
// ================================================================
var M_USERS_H = ['FullName','DOB','Email','Phone','Class','Password','Role','StudentID'];
var M_ATT_H   = ['StudentEmail','ClassID','SessionDate','DayLabel','Status','ParticipationScore','IsDay0'];
var M_HW_H    = ['ClassID','SessionDate','DayLabel','Type','Content','Deadline','AssignedBy'];
var M_PAY_H   = ['ClassID','StudentEmail','MonthNo','PaidDate','Note'];
var M_HWM_H   = ['ClassID','MonthNo','EndedDate'];
var M_SYSTEM  = ['Users','Attendance_Master','Homework_Master','Class_Schedules','Reference',
                 'Tuition_Payments','Archived_Users','HW_Month_Status'];
var M_EXCLUDE = ['reference','agenda','score','archived','archive','tuition','payment','users'];

function mNormEmail(e) { return String(e == null ? '' : e).trim().toLowerCase(); }
function mEmailKey(e)  { return String(e == null ? '' : e).replace(/[@.]/g, '_'); }
function mIsDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function mCell(v) {
  if (mIsDate(v)) return fmtDate(v);
  if (v === null || v === undefined) return '';
  return v;
}
function mIsClassTab(name) {
  if (M_SYSTEM.indexOf(name) >= 0 || name.indexOf('ARCHIVED_') === 0) return false;
  var low = name.toLowerCase();
  return !M_EXCLUDE.some(function(k){ return low.indexOf(k) >= 0; });
}
function mObjRows(values) {
  if (!values || values.length < 2) return [];
  var h = values[0].map(function(x){ return String(x).trim(); });
  return values.slice(1).filter(function(r){ return r.some(function(c){ return c !== '' && c != null; }); })
    .map(function(r){ var o = {}; h.forEach(function(k, i){ if (k) o[k] = r[i]; }); return o; });
}
function mMonthVal(k) { return /^\d+$/.test(k) ? Number(k) : k; }
function mSortKeys(o, numeric) {
  return Object.keys(o || {}).sort(function(a, b){
    if (numeric) { var x = Number(a), y = Number(b); if (!isNaN(x) && !isNaN(y) && x !== y) return x - y; }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// sheets: { name: values2D }, order: [sheet names in tab order]
function tablesToDocs(sheets, order) {
  var students = {}, classes = {}, ord = 0, byRaw = {};
  // One doc per exact Email string, like the Sheet joins. The doc id is the lowercased email
  // (what Firebase Auth puts in the token); a second spelling of the same address (case,
  // stray space) keeps its data apart under 'x:<raw>' instead of being merged.
  // rowId gives a doc to rows that have no email at all.
  function student(email, status, rowId) {
    var raw = String(email == null ? '' : email);
    if (!raw && !rowId) return null;
    var k = raw || rowId;
    if (byRaw[k]) return byRaw[k];
    var id = raw ? mNormEmail(raw) : rowId;
    if (!id || students[id]) id = 'x:' + k.replace(/\//g, '_');
    return byRaw[k] = students[id] = { email: raw, status: status, ord: ord++, u: {},
      archivedDate: '', hwKey: mEmailKey(raw), att: {}, hw: {}, pay: {} };
  }
  function cls(name, status, o) {
    name = String(name).trim();
    if (!name) return null;
    if (!classes[name]) classes[name] = { status: status, ord: o, sched: [], hw: {}, hwm: {} };
    return classes[name];
  }
  function profile(s, row) {
    Object.keys(row).forEach(function(k){
      if (k !== 'Email' && k !== 'Password' && k !== 'ArchivedDate') s.u[k] = mCell(row[k]);
    });
  }
  mObjRows(sheets['Users']).forEach(function(r, i){
    if (r.Email && byRaw[String(r.Email)]) return;
    profile(student(r.Email, 'active', 'row:u' + i), r);
  });
  mObjRows(sheets['Archived_Users']).forEach(function(r, i){
    if (r.Email && byRaw[String(r.Email)]) return;
    var s = student(r.Email, 'archived', 'row:a' + i);
    profile(s, r);
    s.archivedDate = mCell(r.ArchivedDate);
  });
  (order || Object.keys(sheets)).forEach(function(name, i){
    var archived = name.indexOf('ARCHIVED_') === 0;
    if (!archived && !mIsClassTab(name)) return;
    var c = cls(archived ? name.slice(9) : name, archived ? 'archived' : 'active', i);
    c.sched = (sheets[name] || []).map(function(r){
      var v = []; for (var k = 0; k < 7; k++) v.push(mCell(r[k])); return { v: v };
    });
  });
  var hidden = 1000;
  mObjRows(sheets['Attendance_Master']).forEach(function(r){
    var c = String(r.ClassID == null ? '' : r.ClassID), d = fmtDate(r.SessionDate);
    var s = student(r.StudentEmail, 'orphan');
    if (!s || !c || !d || !r.StudentEmail) return;
    (s.att[c] = s.att[c] || {})[d] = { dl: mCell(r.DayLabel), st: mCell(r.Status),
      sc: mCell(r.ParticipationScore), d0: mCell(r.IsDay0) };
  });
  var hwVals = sheets['Homework_Master'] || [];
  if (hwVals.length) {
    var hh = hwVals[0].map(function(x){ return String(x).trim(); });
    var byKey = {};
    Object.keys(students).forEach(function(id){ byKey[students[id].hwKey] = students[id]; });
    var groups = {};
    hh.forEach(function(h, i){
      var m = h.match(/^(.*)_(Status|GradedDate|Note)$/);
      if (!m || i < 7) return;
      (groups[m[1]] = groups[m[1]] || {})[m[2]] = i;
    });
    Object.keys(groups).forEach(function(k){
      if (!byKey[k]) {
        students['key:' + k] = { email: '', status: 'orphan', ord: ord++, u: {}, archivedDate: '',
          hwKey: k, att: {}, hw: {}, pay: {} };
        byKey[k] = students['key:' + k];
      }
    });
    for (var i = 1; i < hwVals.length; i++) {
      var r = hwVals[i], name = String(r[0] == null ? '' : r[0]).trim();
      if (!name) continue;
      var c = cls(name, 'hidden', hidden++), id = 'm' + ('0000' + i).slice(-5);
      c.hw[id] = { sd: mCell(r[1]), dl: mCell(r[2]), t: mCell(r[3]), ct: mCell(r[4]),
                   dd: mCell(r[5]), by: mCell(r[6]), ord: i };
      Object.keys(groups).forEach(function(k){
        var g = groups[k];
        var st = g.Status != null ? mCell(r[g.Status]) : '', gd = g.GradedDate != null ? mCell(r[g.GradedDate]) : '',
            nt = g.Note != null ? mCell(r[g.Note]) : '';
        if (st !== '' || gd !== '' || nt !== '') byKey[k].hw[id] = { st: st, gd: gd, nt: nt };
      });
    }
  }
  mObjRows(sheets['Tuition_Payments']).forEach(function(r){
    var s = student(r.StudentEmail, 'orphan'), c = String(r.ClassID == null ? '' : r.ClassID);
    if (!s || !c || !r.StudentEmail) return;
    (s.pay[c] = s.pay[c] || {})[String(r.MonthNo)] = { d: mCell(r.PaidDate), n: mCell(r.Note) };
  });
  mObjRows(sheets['HW_Month_Status']).forEach(function(r){
    var c = cls(r.ClassID, 'hidden', hidden++);
    if (c) c.hwm[String(r.MonthNo)] = mCell(r.EndedDate);
  });
  Object.keys(students).forEach(function(id){ students[id].cls = mClassDocOf(students[id].u.Class, classes); });
  return { students: students, classes: classes };
}
// Same matching as findClassTab(): exact name, then space/underscore variants, then case-insensitive
function mClassDocOf(cls, classes) {
  cls = String(cls == null ? '' : cls).trim();
  if (!cls) return '';
  var names = Object.keys(classes).filter(function(n){ return classes[n].status !== 'hidden'; });
  var norm = function(x){ return x.toLowerCase().replace(/ /g, '_'); };
  var tries = [cls, cls.replace(/ /g, '_'), cls.replace(/_/g, ' ')];
  for (var i = 0; i < tries.length; i++) if (names.indexOf(tries[i]) >= 0) return tries[i];
  return names.filter(function(n){ return norm(n) === norm(cls); })[0] || '';
}

// students/classes: { id: doc } → { sheets: { name: values2D }, order: [...] }
function docsToTables(students, classes) {
  var sheets = {}, order = [];
  var sList = Object.keys(students).map(function(id){ return students[id]; })
    .sort(function(a, b){ return (a.ord || 0) - (b.ord || 0); });
  var cNames = Object.keys(classes).sort(function(a, b){ return (classes[a].ord || 0) - (classes[b].ord || 0); });

  cNames.forEach(function(n){
    var c = classes[n];
    if (c.status === 'hidden') return;
    var tab = c.status === 'archived' ? 'ARCHIVED_' + n : n;
    sheets[tab] = (c.sched || []).map(function(r){ return (r.v || []).slice(); });
    order.push(tab);
  });

  var extra = {};
  sList.forEach(function(s){ Object.keys(s.u || {}).forEach(function(k){ if (M_USERS_H.indexOf(k) < 0) extra[k] = 1; }); });
  var uh = M_USERS_H.concat(Object.keys(extra).sort());
  function userRow(s) {
    return uh.map(function(k){
      if (k === 'Email') return s.email;
      if (k === 'Password') return '';
      var v = (s.u || {})[k]; return v == null ? '' : v;
    });
  }
  sheets['Users'] = [uh].concat(sList.filter(function(s){ return s.status === 'active'; }).map(userRow));
  sheets['Archived_Users'] = [uh.concat(['ArchivedDate'])].concat(sList.filter(function(s){ return s.status === 'archived'; })
    .map(function(s){ return userRow(s).concat([s.archivedDate || '']); }));

  var att = [];
  sList.forEach(function(s){
    Object.keys(s.att || {}).forEach(function(c){
      Object.keys(s.att[c]).forEach(function(d){
        var a = s.att[c][d];
        att.push({ k: d + '\u0000' + c, o: s.ord || 0,
          row: [s.email, c, d, a.dl == null ? '' : a.dl, a.st == null ? '' : a.st, a.sc == null ? '' : a.sc, a.d0 == null ? '' : a.d0] });
      });
    });
  });
  att.sort(function(x, y){ return x.k < y.k ? -1 : x.k > y.k ? 1 : x.o - y.o; });
  sheets['Attendance_Master'] = [M_ATT_H].concat(att.map(function(x){ return x.row; }));

  var hwRows = [];
  cNames.forEach(function(n){
    Object.keys(classes[n].hw || {}).forEach(function(id){ hwRows.push({ id: id, c: n, h: classes[n].hw[id] }); });
  });
  hwRows.sort(function(a, b){ return (a.h.ord || 0) - (b.h.ord || 0) || (a.id < b.id ? -1 : 1); });
  var hwStudents = sList.filter(function(s){ return Object.keys(s.hw || {}).length; });
  var hwh = M_HW_H.slice();
  hwStudents.forEach(function(s){ hwh.push(s.hwKey + '_Status', s.hwKey + '_GradedDate', s.hwKey + '_Note'); });
  sheets['Homework_Master'] = [hwh].concat(hwRows.map(function(x){
    var h = x.h, row = [x.c, h.sd, h.dl, h.t, h.ct, h.dd, h.by].map(function(v){ return v == null ? '' : v; });
    hwStudents.forEach(function(s){
      var sub = s.hw[x.id] || {};
      row.push(sub.st == null ? '' : sub.st, sub.gd == null ? '' : sub.gd, sub.nt == null ? '' : sub.nt);
    });
    return row;
  }));

  var pay = [M_PAY_H];
  sList.forEach(function(s){
    Object.keys(s.pay || {}).forEach(function(c){
      mSortKeys(s.pay[c], true).forEach(function(mo){
        var p = s.pay[c][mo];
        pay.push([c, s.email, mMonthVal(mo), p.d == null ? '' : p.d, p.n == null ? '' : p.n]);
      });
    });
  });
  sheets['Tuition_Payments'] = pay;

  var hwm = [M_HWM_H];
  cNames.forEach(function(n){
    mSortKeys(classes[n].hwm, true).forEach(function(mo){ hwm.push([n, mMonthVal(mo), classes[n].hwm[mo]]); });
  });
  sheets['HW_Month_Status'] = hwm;

  ['Archived_Users','HW_Month_Status','Tuition_Payments','Homework_Master','Attendance_Master','Users']
    .forEach(function(n){ order.push(n); });
  return { sheets: sheets, order: order };
}

// ── Read functions copied from Code.gs
var SYSTEM_TABS = M_SYSTEM;
var EXCLUDE_KEYWORDS = M_EXCLUDE;
let _attByClass = null;
function toRows(sheet) {
  const d = sheet.getDataRange().getValues();
  if (d.length < 2) return [];
  const h = d[0].map(x=>String(x).trim());
  return d.slice(1).filter(r=>r.some(c=>c!=='')).map(r=>{
    const o={}; h.forEach((k,i)=>o[k]=r[i]); return o;
  });
}

function normalizeClass(id) {
  return String(id||'').toLowerCase().trim().replace(/ /g,'_');
}

function findClassTab(classId) {
  const ss = SS();
  const exact = ss.getSheetByName(classId);
  if (exact) return exact;
  const withUnderscore = ss.getSheetByName(classId.replace(/ /g,'_'));
  if (withUnderscore) return withUnderscore;
  const withSpace = ss.getSheetByName(classId.replace(/_/g,' '));
  if (withSpace) return withSpace;
  const lower = classId.toLowerCase().replace(/ /g,'_');
  const sheets = ss.getSheets();
  return sheets.find(s => s.getName().toLowerCase().replace(/ /g,'_') === lower) || null;
}

function readSchedule(classId) {
  const s = findClassTab(classId);
  if (!s) { Logger.log('No tab found for classId: '+classId); return []; }
  const d = s.getDataRange().getValues();
  const out = [];
  for (let i=1; i<d.length; i++) {
    const r = d[i];
    const dayLabel = String(r[0]||'').trim();
    if (!dayLabel) continue;
    const adjusted = String(r[6]||'').trim();
    const content  = adjusted || String(r[3]||'').trim();
    out.push({
      dayLabel,
      hours:       r[1]||0,
      skill:       String(r[2]||'').trim(),
      content,
      date:        fmtDate(r[4]),
      dateDisplay: fmtDisp(r[4]),
      remaining:   Number(r[5])||0,
    });
  }
  return out;
}

function clearAttendanceMemo() { _attByClass = null; }

function readAttendance(classId, studentEmail) {
  try {
    if (!_attByClass) {
      _attByClass = {};
      toRows(sh('Attendance_Master')).forEach(r=>{
        const rec = {
          email:    r.StudentEmail,
          classId:  r.ClassID,
          date:     fmtDate(r.SessionDate),
          dayLabel: String(r.DayLabel||''),
          status:   String(r.Status||'Present'),
          score:    Number(r.ParticipationScore)||0,
        };
        (_attByClass[r.ClassID] = _attByClass[r.ClassID] || []).push(rec);
      });
    }
    let recs = _attByClass[classId] || [];
    if (studentEmail) recs = recs.filter(r=>r.email===studentEmail);
    // Copies, so callers mutating a record can't corrupt the memo
    return recs.map(r=>Object.assign({}, r));
  } catch(e) { Logger.log('readAttendance err: '+e); return []; }
}

function getClassIds() {
  return SS().getSheets()
    .map(s=>s.getName())
    .filter(n=>{
      if(SYSTEM_TABS.includes(n)) return false;
      if(n.startsWith('ARCHIVED_')) return false;
      const low=n.toLowerCase();
      if(EXCLUDE_KEYWORDS.some(k=>low.includes(k))) return false;
      return true;
    });
}

function getClassNames() {
  const cached = cacheGet('classnames');
  if (cached) { Logger.log('Cache HIT: classnames'); return cached; }
  Logger.log('Cache MISS: classnames');
  const result = { success: true, classes: getClassIds() };
  cachePut('classnames', result);
  return result;
}

function getClassList() {
  const clKey = 'classlist_v' + cacheVersion('all');
  const cached = cacheGet(clKey);
  if (cached) { Logger.log('Cache HIT: classlist'); return cached; }
  Logger.log('Cache MISS: classlist');
  const allUsers = toRows(sh('Users')).filter(u=>(u.Role||'Student')==='Student' && u.Archived!=='Y');
  const classIds = getClassIds();
  const data = classIds.map(classId=>{
    const classNorm = normalizeClass(classId);
    const classUsers = allUsers.filter(u=>normalizeClass(u.Class)===classNorm);
    const attRecs    = readAttendance(classId);
    const students   = classUsers.map(u=>{
      const myAtt = attRecs.filter(r=>r.email===u.Email);
      const present=myAtt.filter(r=>r.status==='Present').length;
      const absent =myAtt.filter(r=>r.status==='Absent').length;
      const late   =myAtt.filter(r=>r.status==='Late').length;
      const total  =myAtt.length;
      return {name:u.FullName, email:u.Email, class:classId,
        studentId: u.StudentID||'',
        total, present, absent, late,
        monthsUsed:Math.floor(total/8), sessInCycle:total%8};
    });
    return {classId, students};
  });
  const result = {success:true, data};
  cachePut(clKey, result);
  return result;
}

function getClassDetail(b) {
  const {classId} = b;
  const cKey = classKey(classId, 'detail');
  const cached = cacheGet(cKey);
  if (cached) { Logger.log('Cache HIT: ' + cKey); return cached; }
  Logger.log('Cache MISS: ' + cKey);
  const classNorm2 = normalizeClass(classId);
  const allUsers = toRows(sh('Users')).filter(u=>normalizeClass(u.Class)===classNorm2 && (u.Role||'Student')==='Student');
  const schedule  = readSchedule(classId);
  const attRecs   = readAttendance(classId);
  let hwRecs=[];
  try { hwRecs=toRows(sh('Homework_Master')).filter(r=>r.ClassID===classId); } catch(e){}
  const realSess = schedule.filter(s=>s.dayLabel.toLowerCase()!=='day 0');
  const totalAttended = [...new Set(attRecs.map(r=>r.date))].length;
  const cycleStart    = Math.floor(totalAttended/8)*8;
  const currentCycleSess = realSess.slice(cycleStart, cycleStart+8);
  const students = allUsers.map(u=>{
    const myAtt = attRecs.filter(r=>r.email===u.Email);
    const present=myAtt.filter(r=>r.status==='Present').length;
    const absent =myAtt.filter(r=>r.status==='Absent').length;
    const late   =myAtt.filter(r=>r.status==='Late').length;
    const total  =myAtt.length;
    const currentCycle = currentCycleSess.map(s=>{
      const rec=myAtt.find(r=>r.date===s.date);
      return {dayLabel:s.dayLabel, date:s.date, skill:s.skill, content:s.content,
        status:rec?.status||null, score:rec?.score||null};
    });
    return {name:u.FullName, email:u.Email,
      total, present, absent, late, monthsUsed:Math.floor(total/8), currentCycle};
  });
  const homework = hwRecs.map(r=>({
    dayLabel:r.DayLabel||'', sessionDate:fmtDate(r.SessionDate),
    type:r.Type, content:r.Content, deadline:fmtDate(r.Deadline),
  }));
  const result4 = {success:true, students, schedule, currentCycleSess, homework};
  cachePut(cKey, result4);
  return result4;
}

function getAttendanceMatrix(b) {
  var classId = b.classId;
  if (!classId) return { success: false, message: 'classId required' };
  var cKey = classKey(classId, 'attmatrix');
  var cached = cacheGet(cKey);
  if (cached) { Logger.log('Cache HIT: ' + cKey); return cached; }
  Logger.log('Cache MISS: ' + cKey);
  var classNorm = normalizeClass(classId);
  var allUsers = toRows(sh('Users')).filter(function(u) {
    return normalizeClass(u.Class) === classNorm &&
           (u.Role || 'Student') === 'Student' &&
           u.Archived !== 'Y';
  });
  var schedule = readSchedule(classId).filter(function(s) {
    var dl = s.dayLabel.toLowerCase().replace(/ /g,'').replace('day','');
    return dl && dl !== '0';
  });
  var attRecs = readAttendance(classId);
  var attMap = {};
  attRecs.forEach(function(r) {
    if (!attMap[r.email]) attMap[r.email] = {};
    attMap[r.email][r.date] = { status: r.status, score: Number(r.score) || 0 };
  });
  var tuitionPayments = {};
  try {
    toRows(sh('Tuition_Payments'))
      .filter(function(r) { return r.ClassID === classId; })
      .forEach(function(r) {
        if (!tuitionPayments[r.StudentEmail]) tuitionPayments[r.StudentEmail] = {};
        tuitionPayments[r.StudentEmail][String(r.MonthNo)] = {
          date: fmtDate(r.PaidDate), note: r.Note || ''
        };
      });
  } catch(e) {}
  var students = allUsers.map(function(u) {
    var myAtt = attMap[u.Email] || {};
    var present = 0, absent = 0, late = 0;
    Object.keys(myAtt).forEach(function(d) {
      var st = myAtt[d].status;
      if (st === 'Present') present++;
      else if (st === 'Absent') absent++;
      else if (st === 'Late') late++;
    });
    var total = present + absent + late;
    return {
      name:            u.FullName,
      email:           u.Email,
      studentId:       u.StudentID || '',
      attendance:      myAtt,
      monthPayments:   tuitionPayments[u.Email] || {},
      total:           total,
      present:         present,
      absent:          absent,
      late:            late,
      monthsCompleted: Math.floor(total / 8),
      sessInCycle:     total % 8
    };
  });
  var resultAM = {
    success:              true,
    students:             students,
    sessions:             schedule,
    totalScheduledMonths: Math.max(1, Math.ceil(schedule.length / 8))
  };
  cachePut(cKey, resultAM);
  return resultAM;
}

function getHWMasterSheet() {
  return shOrCreate('Homework_Master',
    ['ClassID','SessionDate','DayLabel','Type','Content','Deadline','AssignedBy']);
}

function makeHWId(classId, sessionDate, type, deadline) {
  const dateKey = sessionDate || ('EXTRA_' + (deadline||''));
  return (classId+'_'+dateKey+'_'+type).replace(/[^a-zA-Z0-9_]/g,'_');
}

function getHomeworkTracker(b) {
  b = b || {};
  const {classId} = b;
  if (!classId) return {success:false, message:'classId is required.'};
  const cKey = classKey(classId, 'hwtracker');
  const cached = cacheGet(cKey);
  if (cached) { Logger.log('Cache HIT: ' + cKey); return cached; }
  Logger.log('Cache MISS: ' + cKey);
  const classNorm = normalizeClass(classId);
  const users = toRows(sh('Users'))
    .filter(u => normalizeClass(u.Class)===classNorm && (u.Role||'Student')==='Student' && u.Archived!=='Y');
  const s = getHWMasterSheet();
  const d = s.getDataRange().getValues();
  const headers = d[0].map(x=>String(x).trim());
  const allHwRows = d.slice(1).filter(r => String(r[0]).trim()===classId);
  const seen = new Set();
  const hwRows = [];
  allHwRows.forEach(r => {
    const dl = String(r[2]||'').trim();
    const isExtra = dl==='EXTRA' || (!r[1] && !fmtDate(r[1]));
    const key = isExtra
      ? 'EXTRA_'+fmtDate(r[5])+'_'+String(r[3]).trim()
      : fmtDate(r[1])+'_'+String(r[3]).trim();
    if (!seen.has(key)) { seen.add(key); hwRows.push(r); }
  });
  const col = {};
  headers.forEach((h,i) => { if (!(h in col)) col[h] = i; });
  const hwList = hwRows.map(r => {
    const sessionDate = fmtDate(r[col.SessionDate]);
    const deadline = fmtDate(r[col.Deadline]);
    const dayLabel = r[col.DayLabel]||'';
    const type = r[col.Type]||'';
    const isExtra = dayLabel==='EXTRA' || !sessionDate;
    return {
      hwId: makeHWId(classId, sessionDate, type, deadline),
      sessionDate,
      dayLabel,
      type,
      content: r[col.Content]||'',
      deadline,
      isExtra: !!isExtra,
    };
  });
  const students = users.map(u => {
    const emailKey = u.Email.replace(/[@.]/g,'_');
    const statusIdx = emailKey+'_Status' in col ? col[emailKey+'_Status'] : -1;
    const gdIdx = emailKey+'_GradedDate' in col ? col[emailKey+'_GradedDate'] : -1;
    const ntIdx = emailKey+'_Note' in col ? col[emailKey+'_Note'] : -1;
    const subMap = {};
    hwRows.forEach((r, j) => {
      const status = statusIdx>=0 ? (String(r[statusIdx]||'').trim()||'Undone') : 'Done';
      subMap[hwList[j].hwId] = {
        status,
        gradedDate: gdIdx>=0 ? fmtDate(r[gdIdx]) : '',
        note: ntIdx>=0 ? String(r[ntIdx]||'').trim() : '',
      };
    });
    const done    = hwList.filter(h => subMap[h.hwId]?.status==='Done').length;
    const late    = hwList.filter(h => subMap[h.hwId]?.status==='Late').length;
    const partial = hwList.filter(h => subMap[h.hwId]?.status==='Partial').length;
    return {
      name: u.FullName, email: u.Email, studentId: u.StudentID||'',
      submissions: subMap,
      summary: { done, late, partial, undone: hwList.length-done-late-partial, total: hwList.length }
    };
  });
  // Include ordered session dates from schedule (excl. Day 0) so frontend can
  // assign correct month index based on SCHEDULED session order, not HW order
  const schedule = readSchedule(classId);
  const scheduleSessionDates = schedule
    .filter(s => {
      const dl = (s.dayLabel||'').trim().toLowerCase().replace(/ /g,'');
      return dl !== 'day0' && dl !== '0';
    })
    .map(s => s.date)
    .filter(Boolean);

  const resultHW = { success:true, homework: hwList, students, scheduleSessionDates };
  cachePut(cKey, resultHW);
  return resultHW;
}

function getHWMonthStatus(b) {
  const {classId} = b;
  try {
    const s = shOrCreate('HW_Month_Status', ['ClassID','MonthNo','EndedDate']);
    const rows = toRows(s).filter(r => r.ClassID === classId);
    const ended = {};
    rows.forEach(r => { ended[String(r.MonthNo)] = r.EndedDate||''; });
    return {success:true, ended};
  } catch(e) { return {success:false, message:e.message}; }
}

function getRewardsMonths(b) {
  const {classId} = b;
  const attRecs = readAttendance(classId);
  const allDates = [...new Set(
    attRecs.filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'')!=='day0'&&r.dayLabel.trim()!=='0').map(r=>r.date)
  )].sort();
  const monthCount = Math.ceil(allDates.length/8)||0;
  const months = [];
  for(let mo=0; mo<monthCount; mo++){
    months.push({ month: mo+1, dates: allDates.slice(mo*8,(mo+1)*8) });
  }
  return {success:true, months};
}

function getRewardsMonth(b) {
  const {classId, month} = b;
  const allUsers = toRows(sh('Users')).filter(u=>u.Class&&(u.Role||'Student')==='Student'&&u.Archived!=='Y');
  const classNorm = normalizeClass(classId);
  const students = allUsers.filter(u=>normalizeClass(u.Class)===classNorm);
  const attRecs = readAttendance(classId);
  let hwRecs=[]; try{hwRecs=toRows(sh('Homework_Master')).filter(r=>r.ClassID===classId);}catch(e){}
  const allDates = [...new Set(
    attRecs.filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'')!=='day0'&&r.dayLabel.trim()!=='0').map(r=>r.date)
  )].sort();
  const mo = parseInt(month)-1;
  const monthDates = allDates.slice(mo*8,(mo+1)*8);
  if(!monthDates.length) return {success:false, message:'No data for this month'};

  // hwDue = số bài tập thực tế trong tháng (không cố định = 8)
  // Mỗi row trong Homework_Master với SessionDate trong monthDates = 1 bài
  // Dùng Set để dedup theo SessionDate+Type (1 buổi có thể có 2 bài khác skill)
  const hwDueSet = new Set();
  hwRecs.forEach(r => {
    const sesDate = fmtDate(r.SessionDate);
    if(monthDates.includes(sesDate) && r.Type) hwDueSet.add(sesDate+'_'+r.Type);
  });
  const hwDueTotal = hwDueSet.size;

  const studentStats = students.map(s=>{
    const myAtt = attRecs.filter(r=>r.email===s.Email && monthDates.includes(r.date));
    const present  = myAtt.filter(r=>r.status==='Present').length;
    const absent   = myAtt.filter(r=>r.status==='Absent').length;
    const late     = myAtt.filter(r=>r.status==='Late').length;
    const scored   = myAtt.filter(r=>r.score>0);
    const avgScore = scored.length?(scored.reduce((s,x)=>s+x.score,0)/scored.length).toFixed(1):0;
    const payments = getTuitionPayments(classId,s.Email);
    const tuitionPaid = !!payments[String(mo+1)];

    // hwDone: đếm theo từng hwDueSet key mà sinh viên đã nộp Done/Late/Partial
    let hwDone = 0;
    try {
      const hmSheet = sh('Homework_Master');
      const hmData = hmSheet.getDataRange().getValues();
      const hmHeaders = hmData[0].map(x=>String(x).trim());
      const emailKey = s.Email.replace(/[@.]/g,'_');
      const stColKey = emailKey+'_Status';
      const stColIdx = hmHeaders.indexOf(stColKey);
      if(stColIdx >= 0) {
        const hwDueSeen = new Set();
        hmData.slice(1).forEach(r => {
          const sesDate = fmtDate(r[1]);
          const type = String(r[3]||'').trim();
          if(!monthDates.includes(sesDate)||!type) return;
          const key = sesDate+'_'+type;
          if(hwDueSeen.has(key)) return; // dedup
          hwDueSeen.add(key);
          const st = String(r[stColIdx]||'').trim();
          if(['Done','Late','Partial'].includes(st)) hwDone++;
        });
      }
    } catch(e){}

    return {
      name:s.FullName, email:s.Email,
      present, absent, late, avgScore:Number(avgScore),
      tuitionPaid, hwDue:hwDueTotal, hwDone,
      sessions:myAtt.length,
    };
  });

  const sorted = [...studentStats].sort((a,b)=>b.present-a.present||b.avgScore-a.avgScore);
  const diligent = studentStats.filter(s=>s.absent===0&&s.late===0&&s.tuitionPaid&&s.hwDue>0&&s.hwDone>=s.hwDue);
  return {
    success:true,
    month:mo+1, dates:monthDates,
    students:studentStats,
    rewards:{
      diligent1:diligent[0]||null,
      diligent2:diligent[1]||null,
      topParticipation:[...studentStats].sort((a,b)=>b.avgScore-a.avgScore)[0]||null,
    }
  };
}

function getRewards(b) {
  const {classId} = b;
  const allUsers = toRows(sh('Users')).filter(u=>u.Class&&(u.Role||'Student')==='Student'&&u.Archived!=='Y');
  const classNorm = normalizeClass(classId);
  const students = allUsers.filter(u=>normalizeClass(u.Class)===classNorm);
  const attRecs = readAttendance(classId);
  let hwRecs=[]; try{hwRecs=toRows(sh('Homework_Master')).filter(r=>r.ClassID===classId);}catch{}
  const allDates = [...new Set(
    attRecs.filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'')!=='day0').map(r=>r.date)
  )].sort();
  const monthCount = Math.ceil(allDates.length/8)||1;
  const months = [];
  for(let mo=0; mo<monthCount; mo++) {
    const monthDates = allDates.slice(mo*8,(mo+1)*8);
    const studentStats = students.map(s=>{
      const myAtt = attRecs.filter(r=>r.email===s.Email && monthDates.includes(r.date));
      const present  = myAtt.filter(r=>r.status==='Present').length;
      const absent   = myAtt.filter(r=>r.status==='Absent').length;
      const late     = myAtt.filter(r=>r.status==='Late').length;
      const scored   = myAtt.filter(r=>r.score>0);
      const avgScore = scored.length?(scored.reduce((s,x)=>s+x.score,0)/scored.length).toFixed(1):0;
      const payments = getTuitionPayments(classId,s.Email);
      const tuitionPaid = !!payments[String(mo+1)];
      const hwDue = hwRecs.filter(r=>monthDates.includes(fmtDate(r.SessionDate))).length;
      const emailKey = s.Email.replace(/[@.]/g,'_');
      let hwDone = 0;
      try {
        const hmSheet = sh('Homework_Master');
        const hmData = hmSheet.getDataRange().getValues();
        const hmHeaders = hmData[0].map(x=>String(x).trim());
        const stColKey = emailKey+'_Status';
        const stColIdx = hmHeaders.indexOf(stColKey);
        if (stColIdx >= 0) {
          const monthHWRows = hmData.slice(1).filter(r =>
            String(r[0]).trim()===classId && monthDates.includes(fmtDate(r[1]))
          );
          hwDone = monthHWRows.filter(r =>
            ['Done','Late','Partial'].includes(String(r[stColIdx]||'').trim())
          ).length;
        }
      } catch(e){}
      const diligent = present===monthDates.length && late===0 && absent===0 && tuitionPaid;
      return {
        name:s.FullName, email:s.Email,
        present, absent, late, avgScore:Number(avgScore),
        tuitionPaid, hwDue, hwDone, diligent,
        sessions: myAtt.length,
      };
    });
    const sorted = [...studentStats].sort((a,b)=>b.diligent-a.diligent||b.avgScore-a.avgScore);
    months.push({
      month: mo+1,
      dates: monthDates,
      students: studentStats,
      rewards: {
        diligent1: sorted[0]||null,
        diligent2: sorted[1]||null,
        topParticipation: [...studentStats].sort((a,b)=>b.avgScore-a.avgScore)[0]||null,
      }
    });
  }
  return {success:true, months};
}

function getTuitionPayments(classId, studentEmail) {
  try {
    const s = sh('Tuition_Payments');
    const d = s.getDataRange().getValues();
    const h = d[0].map(x=>String(x).trim());
    const cC=h.indexOf('ClassID'), eC=h.indexOf('StudentEmail'),
          mC=h.indexOf('MonthNo'), pC=h.indexOf('PaidDate'), nC=h.indexOf('Note');
    const payments = {};
    for(let i=1;i<d.length;i++){
      if(d[i][cC]===classId && d[i][eC]===studentEmail){
        payments[String(d[i][mC])] = {date: fmtDate(d[i][pC]), note: d[i][nC]||''};
      }
    }
    return payments;
  } catch(e){ return {}; }
}

function getAllTuitionPayments(classId) {
  try {
    const s = sh('Tuition_Payments');
    const rows = toRows(s).filter(r=>r.ClassID===classId);
    return rows.map(r=>({
      email: r.StudentEmail, monthNo: String(r.MonthNo),
      paidDate: fmtDate(r.PaidDate), note: r.Note||''
    }));
  } catch(e){ return []; }
}

function getTuitionForClass(b) {
  const {classId} = b;
  const cKey = classKey(classId, 'tuition');
  const cached = cacheGet(cKey);
  if (cached) { Logger.log('Cache HIT: ' + cKey); return cached; }
  Logger.log('Cache MISS: ' + cKey);
  const classNorm = normalizeClass(classId);
  const users = toRows(sh('Users')).filter(u=>normalizeClass(u.Class)===classNorm && (u.Role||'Student')==='Student' && u.Archived!=='Y');
  const attRecs = readAttendance(classId);
  const payments = getAllTuitionPayments(classId);
  const tab = findClassTab(classId);
  let totalScheduledMonths = 1;
  if (tab) {
    const schedRows = tab.getDataRange().getValues().slice(1);
    const schedSessions = schedRows.filter(r=>{
      const day = String(r[0]||'').toLowerCase().replace(/ /g,'').replace('day','');
      return day && day !== '0';
    });
    totalScheduledMonths = Math.max(1, Math.ceil(schedSessions.length / 8));
  }
  const students = users.map(u=>{
    const myAtt = attRecs.filter(r=>r.email===u.Email && r.dayLabel.toLowerCase().replace(/ /g,'')!=='day0');
    const total = myAtt.length;
    const monthsCompleted = Math.floor(total/8);
    const sessInCycle = total%8;
    const monthPayments = {};
    payments.filter(p=>p.email===u.Email).forEach(p=>{
      monthPayments[p.monthNo] = {date:p.paidDate, note:p.note};
    });
    return {
      name:u.FullName, email:u.Email,
      total, monthsCompleted, sessInCycle,
      monthPayments,
    };
  });
  const result6 = {success:true, students, totalScheduledMonths};
  cachePut(cKey, result6);
  return result6;
}

function getStudentData(b) {
  const {studentEmail, classId} = b;
  const cKey = classKey(classId, 'sd_' + studentEmail.replace(/[@.]/g,'_'));
  const cached = cacheGet(cKey);
  if (cached) { Logger.log('Cache HIT: ' + cKey); return cached; }
  Logger.log('Cache MISS: ' + cKey);
  const schedule  = readSchedule(classId);
  const attRecs   = readAttendance(classId, studentEmail);
  const attMap    = {};
  attRecs.forEach(r=>{ attMap[r.date]=r; });
  const realSess = schedule;
  const sessionsWithAtt = realSess.map(s=>({
    dayLabel: s.dayLabel,
    date:     s.date,
    skill:    s.skill,
    content:  s.content,
    status:   attMap[s.date]?.status || null,
    score:    attMap[s.date]?.score  || null,
  }));
  const attended = sessionsWithAtt.filter(s=>s.status!==null);
  const tuitionSessions = attended.filter(s=>s.dayLabel.toLowerCase().replace(/ /g,'')!=='day0' && s.dayLabel.trim()!=='0');
  const months=[];
  for (let i=0; i<attended.length; i+=8) {
    const chunk = attended.slice(i,i+8);
    const scored = chunk.filter(s=>s.score>0);
    months.push({
      month: Math.floor(i/8)+1,
      sessions: chunk,
      avg: scored.length ? (scored.reduce((s,x)=>s+x.score,0)/scored.length).toFixed(1) : '–',
    });
  }
  // Read Homework_Master once as raw values (not toRows) to avoid header mismatch
  const hwSheet = getHWMasterSheet();
  const hwData = hwSheet.getDataRange().getValues();
  const hwHeaders = hwData[0].map(x=>String(x).trim());
  // Column indices — resolved once from headers, immune to sheet reordering
  const hC = hwHeaders.indexOf('ClassID');
  const sdC = hwHeaders.indexOf('SessionDate');
  const dlbC = hwHeaders.indexOf('DayLabel');
  const tC = hwHeaders.indexOf('Type');
  const ctC2 = hwHeaders.indexOf('Content');
  const ddC = hwHeaders.indexOf('Deadline');
  const emailKey = studentEmail.replace(/[@.]/g,'_');
  const statusColIdx = hwHeaders.indexOf(emailKey+'_Status');

  // Filter rows for this class
  const allHwRows = hwData.slice(1).filter(r => String(r[hC]||'').trim() === classId);

  // Dedup: regular HW key = sessionDate+type; Extra HW key = EXTRA+deadline+type
  const hwSeen = new Set();
  const hwDeduped = [];
  allHwRows.forEach(r => {
    const sesDate = fmtDate(r[sdC]);
    const dayLbl  = String(r[dlbC]||'').trim();
    const type    = String(r[tC]||'').trim();
    const dl      = fmtDate(r[ddC]);
    const isExtra = dayLbl === 'EXTRA' || !sesDate;
    const key = isExtra ? ('EXTRA_'+dl+'_'+type) : (sesDate+'_'+type);
    if (!hwSeen.has(key)) { hwSeen.add(key); hwDeduped.push(r); }
  });

  // Build status map from same raw rows
  const hwStatusMap = {};
  allHwRows.forEach(r => {
    const sesDate = fmtDate(r[sdC]);
    const dayLbl  = String(r[dlbC]||'').trim();
    const type    = String(r[tC]||'').trim();
    const dl      = fmtDate(r[ddC]);
    const isExtra = dayLbl === 'EXTRA' || !sesDate;
    const key = isExtra ? ('EXTRA_'+dl+'_'+type) : (sesDate+'_'+type);
    if (!hwStatusMap[key] && statusColIdx >= 0) {
      const st = String(r[statusColIdx]||'').trim();
      if (st) hwStatusMap[key] = st;
    }
  });

  // today at midnight VN time — prevents timezone-skewed daysLeft
  const todayStr = fmtDate(new Date()); // 'yyyy-MM-dd' in VN timezone
  const todayMid = new Date(todayStr + 'T00:00:00');

  const homework = hwDeduped.map(r => {
    const sesDate = fmtDate(r[sdC]);
    const dayLbl  = String(r[dlbC]||'').trim();
    const type    = String(r[tC]||'').trim();
    const dl      = fmtDate(r[ddC]);
    const isExtra = dayLbl === 'EXTRA' || !sesDate;
    const key     = isExtra ? ('EXTRA_'+dl+'_'+type) : (sesDate+'_'+type);
    const subStatus = hwStatusMap[key] || 'Undone';
    const deadlineDate = dl ? new Date(dl+'T00:00:00') : null;
    const daysLeft = deadlineDate ? Math.ceil((deadlineDate - todayMid) / 86400000) : 0;
    return {
      dayLabel:    dayLbl,
      sessionDate: sesDate,
      type:        type,
      content:     String(r[ctC2]||''),
      deadline:    dl,
      daysLeft:    daysLeft,
      status:      subStatus,
      isExtra:     !!isExtra,
    };
  });
  const recentUndone = homework.filter(h=>h.status==='Undone'&&h.daysLeft<0).length;
  if (recentUndone >= 3) enqueueHWWarning(classId, studentEmail, recentUndone);
  const total=tuitionSessions.length, monthsUsed=Math.floor(total/8), sessInCycle=total%8;
  const payments = getTuitionPayments(b.classId, b.studentEmail);
  const allSchedSessions = schedule.filter(s=>s.dayLabel.toLowerCase().replace(/ /g,'').replace('day','')!=='0');
  const totalScheduledMonths = Math.ceil(allSchedSessions.length / 8) || 1;
  const resultSD = {
    success:true,
    sessions:schedule,
    attendance:sessionsWithAtt,
    homework,
    participation:months,
    tuition:{total, monthsUsed, sessInCycle, payments, totalScheduledMonths},
  };
  cachePut(cKey, resultSD);
  return resultSD;
}

function getArchivedStudents() {
  try {
    const s = shOrCreate('Archived_Users',
      ['FullName','DOB','Email','Phone','Class','Password','Role','StudentID','ArchivedDate']);
    if (s.getLastRow() <= 1) return {success:true, students:[]};
    const rows = toRows(s);
    const students = rows.map(u => ({
      name: u.FullName||'', email: u.Email||'',
      class: u.Class||'', studentId: u.StudentID||'',
      archivedDate: fmtDate(u.ArchivedDate),
      totalSessions: readAttendance(u.Class, u.Email)
        .filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'').replace('day','')!=='0').length,
      monthsCompleted: Math.floor(readAttendance(u.Class, u.Email)
        .filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'').replace('day','')!=='0').length / 8),
    }));
    return {success:true, students};
  } catch(e) { return {success:false, message:e.toString()}; }
}

function getArchivedStudentDetail(b) {
  try {
    const {email} = b;
    const s = shOrCreate('Archived_Users',
      ['FullName','DOB','Email','Phone','Class','Password','Role','StudentID','ArchivedDate']);
    const rows = toRows(s);
    const u = rows.find(r=>r.Email===email);
    if (!u) return {success:false, message:'Student not found in archive'};
    const att = readAttendance(u.Class, email)
      .filter(r=>r.dayLabel.toLowerCase().replace(/ /g,'').replace('day','')!=='0');
    const total = att.length;
    const present = att.filter(r=>r.status==='Present').length;
    const absent  = att.filter(r=>r.status==='Absent').length;
    const late    = att.filter(r=>r.status==='Late').length;
    const payments = getTuitionPayments(u.Class, email);
    return {success:true, student:{
      name:u.FullName, email:u.Email, class:u.Class,
      studentId:u.StudentID||'', archivedDate:fmtDate(u.ArchivedDate),
      totalSessions:total, monthsCompleted:Math.floor(total/8),
      present, absent, late, monthPayments:payments
    }};
  } catch(e){ return {success:false, message:e.toString()}; }
}

function resetAttendance(b) {
  const {studentEmail, classId} = b;
  const recs = readAttendance(classId, studentEmail);
  const byDate = {};
  recs.forEach(r=>{ if(!byDate[r.date]) byDate[r.date]=[]; byDate[r.date].push(r); });
  const duplicates = Object.entries(byDate).filter(([d,arr])=>arr.length>1).map(([d,arr])=>({date:d,count:arr.length}));
  return {success:true, records:recs, duplicates};
}

function getStudentId(b) {
  const users = toRows(sh('Users'));
  const u = users.find(x => x.Email === b.email);
  return { success: !!u, id: u ? (u.StudentID || '') : '' };
}

function isStudentArchived(email) {
  try {
    const s = SS().getSheetByName('Archived_Users');
    if (!s) return false;
    const d = s.getDataRange().getValues();
    const h = d[0].map(x => String(x).trim());
    const eC = h.indexOf('Email');
    if (eC < 0) return false;
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][eC]).trim() === email) return true;
    }
    return false;
  } catch(e) { return false; }
}

function getClassPrefix(className) {
  const name = String(className||'').toLowerCase().trim();
  if (name.includes('ielts'))          return 'IE';
  if (name.includes('general english') || name.includes('general')) return 'GE';
  if (name.includes('teen'))           return 'TE';
  if (name.includes('kid'))            return 'KI';
  if (name.includes('mầm non') || name.includes('mam non') || name.includes('kg')) return 'KG';
  return name.replace(/[^a-z]/g,'').slice(0,2).toUpperCase() || 'XX';
}

function getClassNumber(className) {
  const m = String(className||'').match(/\d+/);
  return m ? m[0] : '';
}

function buildClassCode(className) {
  return getClassPrefix(className) + getClassNumber(className);
}

// ================================================================
// BROWSER CORE — state, Firestore adapter, writes, api() dispatcher
// Read actions are the Code.gs functions above, run over tables rebuilt from Firestore
// (docsToTables), so their results match the old backend exactly.
// ================================================================
var S = { students: {}, classes: {}, meta: {}, ver: 0, role: null, email: null, myId: null };
var _tables = null, _tablesVer = -1;
var Logger = { log: function(){} };
function cacheGet() { return null; }
function cachePut() {}
function cacheRemove() {}
function classKey() { return ''; }
function cacheVersion() { return ''; }

var _vnFmt = null;
function vnDate(d) {
  _vnFmt = _vnFmt || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return _vnFmt.format(d);
}
function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  var d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? String(v) : vnDate(d);
}
function fmtDisp(v) {
  if (!v) return '';
  var s = fmtDate(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(v);
  var mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(s.slice(8), 10) + '-' + mo[parseInt(s.slice(5, 7), 10) - 1] + '-' + s.slice(0, 4);
}
function today() { return vnDate(new Date()); }

// ── Fake SpreadsheetApp over the rebuilt tables
function tables() {
  if (_tablesVer !== S.ver) {
    _tables = docsToTables(S.students, S.classes);
    _tablesVer = S.ver;
    clearAttendanceMemo();
  }
  return _tables;
}
function fakeSheet(name) {
  var vals = tables().sheets[name];
  return { getName: function(){ return name; }, getLastRow: function(){ return vals.length; },
           getDataRange: function(){ return { getValues: function(){ return vals.slice(); } }; } };
}
function SS() {
  var t = tables();
  return { getSheetByName: function(n){ return t.sheets[n] ? fakeSheet(n) : null; },
           getSheets: function(){ return t.order.map(fakeSheet); } };
}
function sh(name) { var s = SS().getSheetByName(name); if (!s) throw new Error('Sheet not found: ' + name); return s; }
function shOrCreate(name, headers) {
  return SS().getSheetByName(name) || { getName: function(){ return name; }, getLastRow: function(){ return headers ? 1 : 0; },
    getDataRange: function(){ return { getValues: function(){ return headers ? [headers.slice()] : []; } }; } };
}

// ── Firestore adapter (swapped for an in-memory one in tests)
var A = null;
var DEL = { __delete: true };
function makeFirebaseAdapter(config) {
  firebase.initializeApp(config);
  var fs = firebase.firestore(), auth = firebase.auth();
  function ref(col, id) { return id ? fs.collection(col).doc(id) : fs.collection(col).doc(); }
  function val(v) { return v === DEL ? firebase.firestore.FieldValue.delete() : v; }
  return {
    commit: function(ops) {
      var b = fs.batch();
      ops.forEach(function(op){
        var r = ref(op.col, op.id);
        if (op.op === 'set') b.set(r, op.data, { merge: !!op.merge });
        else {
          var args = [];
          op.pairs.forEach(function(p){ args.push(new firebase.firestore.FieldPath(p[0][0], ...p[0].slice(1)), val(p[1])); });
          b.update.apply(b, [r].concat(args));
        }
      });
      return b.commit();
    },
    listen: function(col, onData, onErr) {
      return fs.collection(col).onSnapshot({ includeMetadataChanges: false }, function(qs){
        var changes = qs.docChanges().map(function(c){ return { type: c.type, id: c.doc.id, data: c.doc.data() }; });
        onData(changes, qs.metadata.hasPendingWrites);
      }, onErr);
    },
    listenDoc: function(col, id, onData, onErr) {
      return fs.collection(col).doc(id).onSnapshot(function(d){
        onData([{ type: d.exists ? 'modified' : 'removed', id: id, data: d.exists ? d.data() : null }], d.metadata.hasPendingWrites);
      }, onErr);
    },
    get: function(col, id) { return ref(col, id).get().then(function(d){ return d.exists ? d.data() : null; }); },
    onAuth: function(cb) { return auth.onAuthStateChanged(function(u){ cb(u ? { email: u.email } : null); }); },
    signIn: function(e, p) { return auth.signInWithEmailAndPassword(e, p); },
    signOut: function() { return auth.signOut(); },
    createUser: function(e, p) { return auth.createUserWithEmailAndPassword(e, p); },
    resetPassword: function(e) { return auth.sendPasswordResetEmail(e); },
    changePassword: function(e, cur, nw) {
      var u = auth.currentUser;
      return u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(e, cur))
        .then(function(){ return u.updatePassword(nw); });
    },
  };
}

// ── Loading + live updates
var _listeners = [], _remoteCbs = [], _readyP = null, _unsubs = [];
function applyChanges(col, changes, local) {
  var store = col === 'students' ? S.students : col === 'classes' ? S.classes : null;
  changes.forEach(function(c){
    if (col === 'public') { S.meta = c.data || {}; return; }
    if (c.type === 'removed') delete store[c.id]; else store[c.id] = c.data;
  });
  S.ver++;
  if (!local) _remoteCbs.forEach(function(cb){ try { cb(col, changes); } catch(e){ console.error(e); } });
}
function subscribe(col, id) {
  return new Promise(function(resolve, reject){
    var first = true;
    function onData(changes, local) {
      applyChanges(col, changes, local || first);
      if (first) { first = false; resolve(); }
    }
    _unsubs.push(id ? A.listenDoc(col, id, onData, reject) : A.listen(col, onData, reject));
  });
}
// Teacher = allowed to read public/teacher (the teacher list lives only in firestore.rules)
function checkTeacher() {
  return A.get('public', 'teacher').then(function(d){ return !!d; }, function(){ return false; });
}
// Resolves { signedIn:false } or { signedIn:true, role, email } once data is loaded
function ready() {
  if (_readyP) return _readyP;
  if (!A) A = makeFirebaseAdapter(FIREBASE_CONFIG);
  _readyP = new Promise(function(resolve, reject){
    var done = false;
    A.onAuth(function(user){
      // Signed out in another tab (not through signOut() here) → back to the sign-in page
      if (done) { if (!user && !_signingOut) location.href = 'index.html'; return; }
      done = true;
      if (!user) return resolve({ signedIn: false });
      S.email = user.email.toLowerCase();
      checkTeacher().then(function(teacher){
        if (teacher) {
          S.role = 'Teacher';
          return Promise.all([subscribe('students'), subscribe('classes'), subscribe('public', 'meta')])
            .then(function(){ resolve({ signedIn: true, role: 'Teacher', email: S.email }); });
        }
        // A student can read exactly two docs: their own, and their class (rules enforce this)
        S.role = 'Student'; S.myId = S.email;
        return subscribe('students', S.myId).then(function(){
          var me = S.students[S.myId], cls = me && me.cls;
          return cls ? subscribe('classes', cls) : null;
        }).then(function(){ resolve({ signedIn: true, role: 'Student', email: S.email }); });
      }).catch(reject);
    });
  });
  return _readyP;
}

// ── Helpers for writes
function activeStudents() {
  return Object.keys(S.students).map(function(id){ return Object.assign({ _id: id }, S.students[id]); })
    .filter(function(s){ return s.status === 'active'; })
    .sort(function(a, b){ return (a.ord || 0) - (b.ord || 0); });
}
// Same match as the Sheet: exact Email string first, then the account's lowercased id
function findStudent(email) {
  var ids = Object.keys(S.students);
  for (var i = 0; i < ids.length; i++) if (S.students[ids[i]].email === email) return ids[i];
  var id = String(email || '').trim().toLowerCase();
  return S.students[id] ? id : null;
}
function newStudentOp(email, status, profile) {
  var id = String(email).trim().toLowerCase();
  if (S.students[id]) id = 'x:' + String(email).replace(/\//g, '_');
  return { id: id, op: { op: 'set', col: 'students', id: id, data: { email: String(email), status: status,
    ord: Date.now(), u: profile || {}, cls: '', archivedDate: '', hwKey: mEmailKey(email), att: {}, hw: {}, pay: {} } } };
}
function studentFor(email, ops) {
  var id = findStudent(email);
  if (id) return id;
  var n = newStudentOp(email, 'orphan');
  ops.push(n.op);
  return n.id;
}
function hwEntries(classId) {
  var c = S.classes[String(classId).trim()];
  if (!c) return [];
  return Object.keys(c.hw || {}).map(function(id){ return { id: id, h: c.hw[id] }; })
    .sort(function(a, b){ return (a.h.ord || 0) - (b.h.ord || 0) || (a.id < b.id ? -1 : 1); });
}
var _seq = 0;
function newId(p) { return p + Date.now().toString(36) + (_seq++).toString(36) + Math.random().toString(36).slice(2, 5); }
function upd(col, id, pairs) { return { op: 'update', col: col, id: id, pairs: pairs }; }
function outbox(type, data) {
  // 'kind' (not 'type'): payloads carry their own 'type' field (homework skill)
  return { op: 'set', col: 'outbox', id: null, data: Object.assign({}, data, { kind: type, by: S.email, at: new Date().toISOString() }) };
}
function dirty() { return { op: 'set', col: 'outbox', id: 'dirty', data: { kind: 'dirty', at: new Date().toISOString() } }; }
function commit(ops, result) {
  return A.commit(ops).then(function(){ return result || { success: true }; });
}
function att(id, classId, date) { var s = S.students[id]; return s && s.att && s.att[classId] && s.att[classId][date]; }

// ── Write actions (same semantics as the Code.gs functions of the same name)
var WRITES = {
  finishSession: function(b) {
    var classId = b.classId, date = b.date, dayLabel = b.dayLabel || '', overrides = b.attOverrides || {};
    var norm = normalizeClass(classId);
    var isDay0 = dayLabel.trim().toLowerCase().replace(/ /g, '') === 'day0' || dayLabel.trim() === '0';
    var ops = [];
    activeStudents().filter(function(s){ return normalizeClass(s.u.Class) === norm && (s.u.Role || 'Student') === 'Student'; })
      .forEach(function(s){
        var st = overrides[s.email] || 'Present';
        if (att(s._id, classId, date)) ops.push(upd('students', s._id, [[['att', classId, date, 'st'], st], [['att', classId, date, 'sc'], 0]]));
        else ops.push(upd('students', s._id, [[['att', classId, date], { dl: dayLabel, st: st, sc: 0, d0: isDay0 ? 'Y' : '' }]]));
      });
    var existing = hwEntries(classId), newHw = {};
    (b.homework || []).forEach(function(hw){
      if (!hw.content) return;
      var hwDate = hw.sessionDate || date;
      var f = existing.find(function(x){ return fmtDate(x.h.sd) === hwDate && String(x.h.t).trim() === (hw.type || ''); });
      if (f) {
        var pairs = [[['hw', f.id, 'ct'], hw.content]];
        if (hw.deadline) pairs.push([['hw', f.id, 'dd'], hw.deadline]);
        ops.push(upd('classes', String(classId).trim(), pairs));
      } else {
        newHw[newId('h')] = { sd: hwDate, dl: dayLabel, t: hw.type || '', ct: hw.content, dd: hw.deadline || '', by: 'Teacher', ord: Date.now() + _seq++ };
      }
    });
    if (Object.keys(newHw).length) ops.push({ op: 'set', col: 'classes', id: String(classId).trim(), merge: true, data: { hw: newHw } });
    ops.push(outbox('finishSession', { classId: classId, date: date, dayLabel: dayLabel, homework: b.homework || [] }), dirty());
    return commit(ops);
  },
  updateAttendance: function(b) {
    var ops = [], id = studentFor(b.studentEmail, ops);
    if (att(id, b.classId, b.sessionDate)) {
      if (b.status != null) ops.push(upd('students', id, [[['att', b.classId, b.sessionDate, 'st'], b.status]]));
    } else ops.push(upd('students', id, [[['att', b.classId, b.sessionDate], { dl: b.dayLabel || '', st: b.status || 'Present', sc: 0, d0: '' }]]));
    ops.push(outbox('absenceCheck', { classId: b.classId, email: b.studentEmail }), dirty());
    return commit(ops);
  },
  updateScore: function(b) {
    var ops = [], id = studentFor(b.studentEmail, ops), sc = Number(b.score);
    if (att(id, b.classId, b.sessionDate)) ops.push(upd('students', id, [[['att', b.classId, b.sessionDate, 'sc'], sc]]));
    else ops.push(upd('students', id, [[['att', b.classId, b.sessionDate], { dl: '', st: 'Present', sc: sc || 0, d0: '' }]]));
    ops.push(dirty());
    return commit(ops);
  },
  batchUpdateScores: function(b) {
    var ops = [];
    (b.scores || []).forEach(function(sc){
      var id = findStudent(sc.studentEmail);
      if (id && att(id, b.classId, sc.sessionDate))
        ops.push(upd('students', id, [[['att', b.classId, sc.sessionDate, 'sc'], Number(sc.score) || 0]]));
    });
    if (!ops.length) return Promise.resolve({ success: true });
    ops.push(dirty());
    return commit(ops);
  },
  deleteAttRecord: function(b) {
    var id = findStudent(b.studentEmail), pairs = [];
    if (id) Object.keys(S.students[id].att || {}).forEach(function(c){
      if (S.students[id].att[c][b.sessionDate]) pairs.push([['att', c, b.sessionDate], DEL]);
    });
    if (!pairs.length) return Promise.resolve({ success: true, deleted: 0 });
    return commit([upd('students', id, pairs), dirty()], { success: true, deleted: pairs.length });
  },
  addHomework: function(b) {
    var classId = String(b.classId).trim(), isExtra = !!b.isExtra;
    var effDate = isExtra ? '' : (b.sessionDate || ''), effLabel = isExtra ? 'EXTRA' : (b.dayLabel || '');
    var f = hwEntries(classId).find(function(x){
      if (String(x.h.t).trim() !== (b.type || '')) return false;
      var rowDate = fmtDate(x.h.sd);
      return isExtra ? (!rowDate && fmtDate(x.h.dd) === (b.deadline || '')) : rowDate === effDate;
    });
    var ops = [];
    if (f) {
      var pairs = [[['hw', f.id, 'ct'], b.content]];
      if (b.deadline) pairs.push([['hw', f.id, 'dd'], b.deadline]);
      ops.push(upd('classes', classId, pairs));
    } else {
      var hw = {}; hw[newId('h')] = { sd: effDate, dl: effLabel, t: b.type || '', ct: b.content, dd: b.deadline || '', by: 'Teacher', ord: Date.now() + _seq++ };
      ops.push({ op: 'set', col: 'classes', id: classId, merge: true, data: { hw: hw } });
    }
    ops.push(outbox('addHomework', { classId: classId, hw: { type: b.type || '', content: b.content, deadline: b.deadline || '', sessionDate: effDate, isExtra: isExtra } }), dirty());
    return commit(ops);
  },
  saveHomeworkSubmission: function(b) {
    var f = hwEntries(b.classId).find(function(x){
      if (String(x.h.t).trim() !== b.type) return false;
      var rowDate = fmtDate(x.h.sd);
      return !rowDate ? fmtDate(b.deadline) === fmtDate(x.h.dd) : rowDate === b.sessionDate;
    });
    if (!f) return Promise.resolve({ success: false, message: 'Homework row not found' });
    var ops = [], id = studentFor(b.studentEmail, ops);
    var pairs = [[['hw', f.id, 'st'], b.status || 'Undone'], [['hw', f.id, 'gd'], today()]];
    if (b.note !== undefined) pairs.push([['hw', f.id, 'nt'], b.note || '']);
    else if (!((S.students[id] || {}).hw || {})[f.id]) pairs.push([['hw', f.id, 'nt'], '']);
    ops.push(upd('students', id, pairs), dirty());
    return commit(ops);
  },
  saveAllHomeworkDone: function(b) {
    var classId=String(b.classId||'').trim(), emails=b.studentEmails||[], assignments=b.assignments||[];
    if(!classId||!emails.length||!assignments.length)return Promise.resolve({success:false,message:'classId, students, and homework are required'});
    var entries=hwEntries(classId),resolved=[],seen={};
    assignments.forEach(function(hw){
      var match=entries.find(function(x){
        if(String(x.h.t).trim()!==String(hw.type||'').trim())return false;
        var rowDate=fmtDate(x.h.sd);
        return rowDate?rowDate===hw.sessionDate:!hw.sessionDate&&fmtDate(x.h.dd)===fmtDate(hw.deadline);
      });
      if(match&&!seen[match.id]){seen[match.id]=true;resolved.push(match);}
    });
    if(!resolved.length)return Promise.resolve({success:false,message:'No matching homework assignments found'});
    var ops=[];
    emails.forEach(function(email){
      var id=studentFor(email,ops),pairs=[];
      resolved.forEach(function(entry){pairs.push([['hw',entry.id,'st'],'Done'],[['hw',entry.id,'gd'],today()]);});
      if(id)ops.push(upd('students',id,pairs));
    });
    if(!ops.length)return Promise.resolve({success:false,message:'No students found'});
    ops.push(dirty());
    return commit(ops,{success:true,updated:emails.length*resolved.length});
  },
  deleteHomework: function(b) {
    if (!b.classId || !b.sessionDate) return Promise.resolve({ success: false, message: 'classId and sessionDate required' });
    var ids = hwEntries(b.classId).filter(function(x){
      return fmtDate(x.h.sd) === b.sessionDate && (!b.type || String(x.h.t).trim() === b.type);
    }).map(function(x){ return x.id; });
    if (!ids.length) return Promise.resolve({ success: true, deleted: 0 });
    var ops = [upd('classes', String(b.classId).trim(), ids.map(function(i){ return [['hw', i], DEL]; }))];
    Object.keys(S.students).forEach(function(sid){
      var p = ids.filter(function(i){ return (S.students[sid].hw || {})[i]; }).map(function(i){ return [['hw', i], DEL]; });
      if (p.length) ops.push(upd('students', sid, p));
    });
    ops.push(dirty());
    return commit(ops, { success: true, deleted: ids.length });
  },
  updateHomeworkDeadline: function(b) {
    if (!b.classId || !b.sessionDate || !b.type || !b.deadline) return Promise.resolve({ success: false, message: 'Missing required fields.' });
    var rows = hwEntries(b.classId).filter(function(x){ return fmtDate(x.h.sd) === b.sessionDate && String(x.h.t).trim() === b.type; });
    if (!rows.length) return Promise.resolve({ success: true, updated: 0 });
    var content = rows.map(function(x){ return String(x.h.ct || '').trim(); }).filter(Boolean)[0] || '';
    return commit([upd('classes', String(b.classId).trim(), rows.map(function(x){ return [['hw', x.id, 'dd'], b.deadline]; })),
      outbox('hwDeadline', { classId: b.classId, sessionDate: b.sessionDate, type: b.type, deadline: b.deadline, content: content }), dirty()],
      { success: true, updated: rows.length });
  },
  endHWMonth: function(b) {
    var classId = String(b.classId).trim(), key = String(b.monthNo);
    var exists = !!(S.classes[classId] && (S.classes[classId].hwm || {})[key] !== undefined);
    if (b.reopen && !exists) return Promise.resolve({ success: true, action: 'not_found' });
    var hwm = {}; hwm[key] = b.reopen ? DEL : today();
    var op = exists ? upd('classes', classId, [[['hwm', key], hwm[key]]])
                    : { op: 'set', col: 'classes', id: classId, merge: true, data: { hwm: hwm } };
    return commit([op, dirty()], { success: true, action: b.reopen ? 'reopened' : exists ? 'updated' : 'created' });
  },
  markTuitionPaid: function(b) {
    var ops = [], key = String(b.monthNo), id = findStudent(b.studentEmail);
    var cur = id && ((S.students[id].pay || {})[b.classId] || {})[key];
    if (cur) {
      if (!b.paid) ops.push(upd('students', id, [[['pay', b.classId, key], DEL]]));
      else {
        var pairs = [[['pay', b.classId, key, 'd'], b.paidDate || today()]];
        if (b.note !== undefined) pairs.push([['pay', b.classId, key, 'n'], b.note || '']);
        ops.push(upd('students', id, pairs));
      }
    } else if (b.paid) {
      if (!id) id = studentFor(b.studentEmail, ops);
      var d = b.paidDate || today();
      ops.push(upd('students', id, [[['pay', b.classId, key], { d: d, n: b.note || '' }]]),
        outbox('tuitionPaid', { classId: b.classId, email: b.studentEmail, monthNo: b.monthNo, paidDate: d, note: b.note || '' }));
    } else return Promise.resolve({ success: true });
    ops.push(dirty());
    return commit(ops);
  },
  archiveStudent: function(b) {
    var id = Object.keys(S.students).find(function(i){
      return S.students[i].email === b.email && S.students[i].status === (b.archive ? 'active' : 'archived');
    });
    if (!id) return Promise.resolve({ success: false, message: b.archive ? 'Student not found' : 'Student not found in archive' });
    // ord = now: the Sheet version appended the row at the end of the target sheet
    var ops = [upd('students', id, b.archive ? [[['status'], 'archived'], [['archivedDate'], today()], [['ord'], Date.now() + _seq++]]
                                             : [[['status'], 'active'], [['ord'], Date.now() + _seq++]])];
    if (b.archive) ops.push(outbox('archiveStudent', { email: b.email }));
    ops.push(dirty());
    return commit(ops);
  },
  archiveClass: function(b) {
    var classId = b.classId, ops = [];
    if (b.archive) {
      var tab = findClassTab(classId);
      if (!tab) return Promise.resolve({ success: false, message: 'Class tab not found' });
      ops.push(upd('classes', tab.getName(), [[['status'], 'archived']]));
      var variants = [classId, classId.replace(/ /g, '_'), classId.replace(/_/g, ' ')];
      activeStudents().forEach(function(s){
        if (variants.indexOf(String(s.u.Class || '').trim()) >= 0)
          ops.push(upd('students', s._id, [[['status'], 'archived'], [['archivedDate'], today()], [['ord'], Date.now() + _seq++]]));
      });
    } else {
      if (!S.classes[classId] || S.classes[classId].status !== 'archived') return Promise.resolve({ success: false, message: 'Archived tab not found' });
      ops.push(upd('classes', classId, [[['status'], 'active']]));
    }
    ops.push(dirty());
    return commit(ops);
  },
  assignAllStudentIds: function() {
    var users = activeStudents(), counters = {}, byClass = {}, order = [];
    users.forEach(function(s){
      var sid = String(s.u.StudentID || '').trim();
      if (sid && sid.indexOf('-') >= 0) {
        var p = sid.split('-'), n = parseInt(p[1]) || 0;
        if (!counters[p[0]] || n > counters[p[0]]) counters[p[0]] = n;
      }
    });
    users.forEach(function(s){
      if (String(s.u.StudentID || '').trim()) return;
      var cls = String(s.u.Class || '').trim();
      if (!cls) return;
      if (!byClass[cls]) { byClass[cls] = []; order.push(cls); }
      byClass[cls].push(s);
    });
    var ops = [];
    order.forEach(function(cls){
      var code = buildClassCode(cls);
      counters[code] = counters[code] || 0;
      byClass[cls].forEach(function(s){
        counters[code]++;
        ops.push(upd('students', s._id, [[['u', 'StudentID'], code + '-' + String(counters[code]).padStart(3, '0')]]));
      });
    });
    if (!ops.length) return Promise.resolve({ success: true, assigned: 0 });
    ops.push(dirty());
    return commit(ops, { success: true, assigned: ops.length - 1 });
  },
  sendReport: function() { return commit([outbox('sendReport', {})]); },
  changePassword: function(b) {
    if (!b.newPassword || b.newPassword.length < 6) return Promise.resolve({ success: false, message: 'New password must be at least 6 characters.' });
    return A.changePassword(b.email || S.email, b.currentPassword, b.newPassword)
      .then(function(){ return { success: true }; },
            function(e){ return { success: false, message: /wrong-password|invalid-credential|invalid-login/.test(e.code || '') ? 'Current password is incorrect.' : (e.message || String(e)) }; });
  },
};

// getStudentData (from Code.gs) calls this instead of sending the warning email itself
var _warned = {};
function enqueueHWWarning(classId, email, count) {
  if (_warned[email]) return;
  _warned[email] = true;
  A.commit([outbox('hwWarning', { classId: classId, email: email, count: count })]).catch(function(){});
}

var READS = {
  getClassList: getClassList, getClassDetail: getClassDetail, getAttendanceMatrix: getAttendanceMatrix,
  getHomeworkTracker: getHomeworkTracker, getHWMonthStatus: getHWMonthStatus, getRewardsMonths: getRewardsMonths,
  getRewardsMonth: getRewardsMonth, getTuitionForClass: getTuitionForClass, getStudentData: getStudentData,
  getArchivedStudents: getArchivedStudents, getArchivedStudentDetail: getArchivedStudentDetail,
  resetAttendance: resetAttendance, getStudentId: getStudentId,
  getClassNames: function(){ return S.role === 'Teacher' ? getClassNames() : { success: true, classes: (S.meta.classNames || []) }; },
  getRewards: function(b){ return S.role === 'Teacher' ? getRewards(b) : { success: false, message: 'Not allowed' }; },
  // Student page: own ranking only (position among classmates, no names), written by the worker
  getMyRanking: function(){
    var me = S.students[S.myId];
    return me && me.rk ? { success: true, ranking: me.rk } : { success: true, ranking: null };
  },
};

function api(action, data) {
  return ready().then(function(st){
    if (!st.signedIn) throw new Error('Not signed in');
    data = Object.assign({}, data || {});
    try {
      if (READS[action]) return JSON.parse(JSON.stringify(READS[action](data)));
      if (WRITES[action]) {
        if (S.role !== 'Teacher') return { success: false, message: 'Not allowed' };
        return WRITES[action](data);
      }
      if (action === 'changePassword') return WRITES.changePassword(data);
      return { success: false, message: 'Unknown action: ' + action };
    } catch(e) {
      console.error('[EduPortal] ' + action, e);
      return { success: false, message: e.toString() };
    }
  });
}

// ── Sign-in page helpers (index.html)
function login(email, password) {
  if (!A) A = makeFirebaseAdapter(FIREBASE_CONFIG);
  email = String(email || '').trim().toLowerCase();
  return A.signIn(email, password).then(checkTeacher).then(function(teacher){
    if (teacher) return { success: true, user: { Role: 'Teacher', FullName: 'Teacher', Email: email } };
    return A.get('students', email).then(function(s){
      if (!s || s.status !== 'active') { A.signOut(); return { success: false, message: 'This account is not active. Please contact your teacher.' }; }
      return { success: true, user: { FullName: s.u.FullName, Email: s.email, Class: s.u.Class, Role: s.u.Role || 'Student', StudentID: s.u.StudentID || '' } };
    });
  }, function(e){
    var c = e.code || '';
    return { success: false, message: /user-not-found|wrong-password|invalid-credential|invalid-login|invalid-email/.test(c)
      ? 'Incorrect email or password.' : /too-many-requests/.test(c) ? 'Too many attempts. Please wait a few minutes.' : (e.message || c) };
  });
}
function register(d) {
  if (!A) A = makeFirebaseAdapter(FIREBASE_CONFIG);
  var email = String(d.email || '').trim().toLowerCase();
  var TAKEN = { code: 'auth/email-already-in-use' };
  function saveProfile() {
    return A.commit([
      { op: 'set', col: 'students', id: email, data: { email: email, status: 'active', ord: Date.now(),
        u: { FullName: d.fullName, DOB: d.dob || '', Phone: d.phone || '', Class: d.classId, Role: 'Student', StudentID: String(d.studentId || '').trim() },
        cls: d.classId, archivedDate: '', hwKey: mEmailKey(email), att: {}, hw: {}, pay: {} } },
      { op: 'set', col: 'outbox', id: null, data: { kind: 'register', email: email, classId: d.classId, fullName: d.fullName, by: email, at: new Date().toISOString() } },
    ]);
  }
  function quietSignOut() { return Promise.resolve(A.signOut()).catch(function(){}); }
  return A.createUser(email, d.password).catch(function(e){
    if (!/email-already-in-use/.test(e.code || '')) throw e;
    // The login exists. If an earlier attempt stopped before the profile was saved (e.g. a rules error),
    // finish it now; if the profile exists, or the password differs, it really is taken.
    return A.signIn(email, d.password).then(function(){ return A.get('students', email); }).then(
      function(profile){ if (profile) throw TAKEN; },
      function(){ throw TAKEN; });
  }).then(saveProfile).then(quietSignOut).then(function(){ return { success: true }; }, function(e){
    return quietSignOut().then(function(){
      return { success: false, message: /email-already-in-use/.test(e.code || '') ? 'Email already registered.' : (e.message || e.code) };
    });
  });
}
function publicClassNames() {
  if (!A) A = makeFirebaseAdapter(FIREBASE_CONFIG);
  return A.get('public', 'meta').then(function(m){ return { success: true, classes: (m && m.classNames) || [] }; });
}
function resetPassword(email) {
  if (!A) A = makeFirebaseAdapter(FIREBASE_CONFIG);
  return A.resetPassword(String(email || '').trim().toLowerCase()).then(function(){ return { success: true }; },
    function(e){ return { success: false, message: /user-not-found|invalid-email/.test(e.code || '') ? 'Email not found.' : (e.message || e.code) }; });
}
var _signingOut = false;
function signOut() { _signingOut = true; return (A ? A.signOut() : Promise.resolve()).then(function(){ _unsubs.forEach(function(u){ try { u(); } catch(e){} }); }); }

var DB = {
  api: api, ready: ready, login: login, register: register, resetPassword: resetPassword,
  publicClassNames: publicClassNames, signOut: signOut,
  onRemoteChange: function(cb){ _remoteCbs.push(cb); },
  _setAdapter: function(a){ A = a; }, _state: S,
};

(typeof window !== "undefined" ? window : globalThis).DB = DB;
})();
