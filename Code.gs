// ================================================================
// IELTS HUB — Google Apps Script Backend v4
// ================================================================
const SS_ID        = '1MaTSpLSuinflq_ojm-MrAxh9An-mCAXSDRRzmf7F3gU';
const REPORT_EMAIL = 'duongthanhtu.dnu@gmail.com';
// Every sheet created by shOrCreate() must be listed here, otherwise getClassIds() treats it as a class
const SYSTEM_TABS  = ['Users','Attendance_Master','Homework_Master','Class_Schedules','Reference','Tuition_Payments','Archived_Users','HW_Month_Status'];
const EXCLUDE_KEYWORDS = ['reference','agenda','score','archived','archive','tuition','payment','users'];
function doGet()  { return J({success:true, message:'EduPortal API v4'}); }
function doPost(e) {
  try {
    const b = (e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : (e.parameter||{});
    Logger.log('▶ '+b.action);
    switch(b.action) {
      case 'assignAllStudentIds':  return J(assignAllStudentIds());
      case 'getStudentId':         return J(getStudentId(b));
      case 'login':            return J(login(b));
      case 'register':         return J(register(b));
      case 'sendOTP':          return J(sendOTP(b));
      case 'resetPassword':    return J(resetPassword(b));
      case 'getStudentData':   return J(getStudentData(b));
      case 'getClassNames':    return J(getClassNames());
      case 'getRewardsMonths': return J(getRewardsMonths(b));
      case 'getRewardsMonth':  return J(getRewardsMonth(b));
      case 'endHWMonth':       return J(endHWMonth(b));
      case 'getHWMonthStatus': return J(getHWMonthStatus(b));
      case 'getClassList':     return J(getClassList(b));
      case 'getClassSummary':  return J(getClassSummary());
      case 'getClassDetail':   return J(getClassDetail(b));
      case 'finishSession':    return J(finishSession(b));
      case 'updateAttendance': return J(updateAttendance(b));
      case 'updateScore':      return J(updateScore(b));
      case 'batchUpdateScores': return J(batchUpdateScores(b));
      case 'addHomework':      return J(addHomework(b));
      case 'sendReport':       return J(sendReport());
      case 'changePassword':   return J(changePassword(b));
      case 'archiveStudent':           return J(archiveStudent(b));
      case 'archiveClass':             return J(archiveClass(b));
      case 'getArchivedStudents':      return J(getArchivedStudents());
      case 'getArchivedStudentDetail': return J(getArchivedStudentDetail(b));
      case 'markTuitionPaid':    return J(markTuitionPaid(b));
      case 'getTuitionForClass':   return J(getTuitionForClass(b));
      case 'getHomeworkTracker':   return J(getHomeworkTracker(b));
      case 'saveHomeworkSubmission': return J(saveHomeworkSubmission(b));
      case 'getRewards':          return J(getRewards(b));
      case 'deleteAttRecord':     return J(deleteAttRecord(b));
      case 'resetAttendance':     return J(resetAttendance(b));
      case 'getAttendanceMatrix': return J(getAttendanceMatrix(b));
      case 'prePopulateSession':  return J(prePopulateSession(b.classId, b.date, b.dayLabel));
      case 'deleteHomework':      return J(deleteHomework(b));
      case 'updateHomeworkDeadline': return J(updateHomeworkDeadline(b));
      case 'createClass':        return J(createClass(b));
      case 'getArchivedClasses':  return J(getArchivedClasses());
      default: return J({success:false, message:'Unknown action: '+b.action});
    }
  } catch(err) {
    Logger.log('ERR: '+err+'\n'+err.stack);
    return J({success:false, message:err.toString()});
  }
}
function J(d) {
  return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON);
}

// ── Write lock: prevent race conditions when multiple users write simultaneously
// GAS ScriptLock is per-script — blocks concurrent executions up to 30s
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // wait up to 10s to acquire
    return fn();
  } catch(e) {
    if (e.message && e.message.includes('Could not obtain lock')) {
      Logger.log('Lock timeout — concurrent write detected');
      throw new Error('Server is busy, please try again in a moment.');
    }
    throw e;
  } finally {
    try { lock.releaseLock(); } catch(e2) {}
  }
}

// ================================================================
// CACHE LAYER — GAS CacheService (5-min TTL)
// Reduces Sheets reads for heavy GET actions
// ================================================================
const CACHE_TTL = 600; // seconds (10 min)

// CacheService caps each value at 100KB, so large payloads are split into chunks.
// The main key then holds a marker '__chunks:N' and the parts live in key#0..key#N-1.
// 30000 chars keeps each chunk under 100KB even if every char were 3-byte UTF-8.
const CACHE_CHUNK = 30000;
const CHUNK_MARK  = '__chunks:';

function chunkKeys(key, n) {
  const keys = [];
  for (let i=0; i<n; i++) keys.push(key+'#'+i);
  return keys;
}

function cacheGet(key) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(key);
    if (!raw) return null;
    if (!raw.startsWith(CHUNK_MARK)) return JSON.parse(raw);
    const keys = chunkKeys(key, Number(raw.slice(CHUNK_MARK.length)));
    const parts = cache.getAll(keys);
    if (keys.some(k => parts[k] == null)) return null; // a chunk expired → treat as miss
    return JSON.parse(keys.map(k => parts[k]).join(''));
  } catch(e) { return null; }
}

function cachePut(key, data) {
  try {
    const cache = CacheService.getScriptCache();
    const str = JSON.stringify(data);
    if (str.length <= CACHE_CHUNK) { cache.put(key, str, CACHE_TTL); return; }
    const n = Math.ceil(str.length / CACHE_CHUNK);
    const parts = {};
    chunkKeys(key, n).forEach((k,i) => parts[k] = str.slice(i*CACHE_CHUNK, (i+1)*CACHE_CHUNK));
    // Chunks first, marker last: a reader never sees a marker without its chunks
    cache.putAll(parts, CACHE_TTL);
    cache.put(key, CHUNK_MARK + n, CACHE_TTL);
  } catch(e) { Logger.log('cachePut err: ' + e); }
}

function cacheRemove(key) {
  try {
    const cache = CacheService.getScriptCache();
    const raw = cache.get(key);
    if (raw && raw.startsWith(CHUNK_MARK)) cache.removeAll(chunkKeys(key, Number(raw.slice(CHUNK_MARK.length))));
    cache.remove(key);
  } catch(e) {}
}

function cacheRemovePrefix(prefix) {
  // CacheService has no list/prefix-delete — we store an index per prefix
  try {
    const indexKey = '__idx_' + prefix;
    const raw = CacheService.getScriptCache().get(indexKey);
    const keys = raw ? JSON.parse(raw) : [];
    keys.forEach(k => cacheRemove(k));
    cacheRemove(indexKey);
  } catch(e) {}
}

function cachePutIndexed(prefix, key, data) {
  // Store data + register key in prefix index for bulk invalidation
  cachePut(key, data);
  try {
    const indexKey = '__idx_' + prefix;
    const raw = CacheService.getScriptCache().get(indexKey);
    const keys = raw ? JSON.parse(raw) : [];
    if (!keys.includes(key)) keys.push(key);
    CacheService.getScriptCache().put(indexKey, JSON.stringify(keys), CACHE_TTL + 60);
  } catch(e) {}
}

// Invalidate everything for a given classId
function invalidateClass(classId) {
  cacheRemovePrefix('cls_' + classId);
  cacheRemove('classlist');
  cacheRemove('classnames');
  Logger.log('Cache invalidated for: ' + classId);
}
// Class names + student counts only depend on Users / sheet tabs, NOT on attendance.
// Call this only from functions that add, archive, restore or rename students/classes.
function invalidateSummary() {
  cacheRemove('classsummary');
  cacheRemove('classlist');
  cacheRemove('classnames');
}


// ── Helpers
let _ss = null; // per-execution: GAS re-initialises globals on every request
function SS() { return _ss || (_ss = SpreadsheetApp.openById(SS_ID)); }
function sh(name) {
  const s = SS().getSheetByName(name);
  if (!s) throw new Error('Sheet not found: '+name);
  return s;
}
function shOrCreate(name, headers) {
  const ss = SS();
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(headers); }
  else if (s.getLastRow()===0) s.appendRow(headers);
  return s;
}
function toRows(sheet) {
  const d = sheet.getDataRange().getValues();
  if (d.length < 2) return [];
  const h = d[0].map(x=>String(x).trim());
  return d.slice(1).filter(r=>r.some(c=>c!=='')).map(r=>{
    const o={}; h.forEach((k,i)=>o[k]=r[i]); return o;
  });
}
const _fmtDateMemo = {};
function fmtDate(v) {
  if (!v) return '';
  const memoKey = v instanceof Date ? v.getTime() : 's' + v;
  if (memoKey in _fmtDateMemo) return _fmtDateMemo[memoKey];
  return (_fmtDateMemo[memoKey] = fmtDateRaw(v));
}
function fmtDateRaw(v) {
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return String(v);
    return Utilities.formatDate(d,'Asia/Ho_Chi_Minh','yyyy-MM-dd');
  } catch(e) { return String(v); }
}
function fmtDisp(v) {
  if (!v) return '';
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return String(v);
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate()+'-'+months[d.getMonth()]+'-'+d.getFullYear();
  } catch(e) { return String(v); }
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
function normalizeClass(id) {
  return String(id||'').toLowerCase().trim().replace(/ /g,'_');
}
// ── Change Password
function changePassword(b) {
  const {email, currentPassword, newPassword} = b;
  const s = sh('Users'), d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('Email'), pC=h.indexOf('Password');
  for (let i=1;i<d.length;i++) {
    if (d[i][eC]===email) {
      if (String(d[i][pC])!==currentPassword)
        return {success:false, message:'Current password is incorrect.'};
      if (!newPassword||newPassword.length<6)
        return {success:false, message:'New password must be at least 6 characters.'};
      s.getRange(i+1,pC+1).setValue(newPassword);
      return {success:true};
    }
  }
  return {success:false, message:'Account not found.'};
}
// ── Read class schedule tab
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
// ── Read/write Attendance_Master
// Per-execution memo of all attendance grouped by class. getClassList() and
// getArchivedStudents() call readAttendance() many times in one request; without
// this each call re-read and re-formatted the whole sheet.
// Every function that writes Attendance_Master must call clearAttendanceMemo().
let _attByClass = null;
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
function writeAttendance(email, classId, date, dayLabel, status, score, isDay0) {
  clearAttendanceMemo();
  return withLock(() => {
  const s = shOrCreate('Attendance_Master',
    ['StudentEmail','ClassID','SessionDate','DayLabel','Status','ParticipationScore','IsDay0']);
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('StudentEmail'), cC=h.indexOf('ClassID'),
        dC=h.indexOf('SessionDate'),  stC=h.indexOf('Status'), scC=h.indexOf('ParticipationScore');
  for (let i=1; i<d.length; i++) {
    if (d[i][eC]===email && d[i][cC]===classId && fmtDate(d[i][dC])===date) {
      if (status!==undefined && status!==null) s.getRange(i+1,stC+1).setValue(status);
      if (score!==undefined  && score!==null)  s.getRange(i+1,scC+1).setValue(score);
      return;
    }
  }
  s.appendRow([email, classId, date, dayLabel||'', status||'Present', score||0, isDay0?'Y':'']);
  }); // end withLock
}
function batchWriteAttendance(rows) {
  if (!rows || !rows.length) return;
  clearAttendanceMemo();
  return withLock(() => {
  const s = shOrCreate('Attendance_Master',
    ['StudentEmail','ClassID','SessionDate','DayLabel','Status','ParticipationScore','IsDay0']);
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('StudentEmail'), cC=h.indexOf('ClassID'),
        dC=h.indexOf('SessionDate'),  stC=h.indexOf('Status'), scC=h.indexOf('ParticipationScore');
  const existingMap = {};
  for (let i=1; i<d.length; i++) {
    const key = d[i][eC]+'|'+d[i][cC]+'|'+fmtDate(d[i][dC]);
    existingMap[key] = i;
  }
  const toAppend = [];
  const toUpdate = [];
  rows.forEach(r => {
    const key = r.email+'|'+r.classId+'|'+r.date;
    if (existingMap[key] !== undefined) {
      const i = existingMap[key];
      if (r.status !== undefined && r.status !== null)
        toUpdate.push({row: i+1, col: stC+1, val: r.status});
      if (r.score !== undefined && r.score !== null)
        toUpdate.push({row: i+1, col: scC+1, val: r.score});
    } else {
      toAppend.push([r.email, r.classId, r.date, r.dayLabel||'',
                     r.status||'Present', r.score||0, r.isDay0?'Y':'']);
    }
  });
  if (toAppend.length) {
    s.getRange(s.getLastRow()+1, 1, toAppend.length, toAppend[0].length)
     .setValues(toAppend);
  }
  toUpdate.forEach(u => s.getRange(u.row, u.col).setValue(u.val));
  }); // end withLock
}
// ── AUTH
function login(b) {
  const u = toRows(sh('Users')).find(x=>x.Email===b.email && x.Password===b.password);
  if (!u) return {success:false, message:'Incorrect email or password.'};
  return {success:true, user:{FullName:u.FullName, Email:u.Email, Class:u.Class, Role:u.Role||'Student', StudentID:u.StudentID||''}};
}
function register(b) {
  if (!b.fullName||!b.email||!b.password||!b.classId)
    return {success:false, message:'Please fill in all fields.'};
  const s = shOrCreate('Users',['FullName','DOB','Email','Phone','Class','Password','Role','StudentID']);
  if (toRows(s).find(u=>u.Email===b.email)) return {success:false, message:'Email already registered.'};
  const newId = generateStudentId(b.classId);
  s.appendRow([b.fullName, b.dob||'', b.email, b.phone||'', b.classId, b.password, 'Student', newId]);
  invalidateSummary(); invalidateClass(b.classId);
  // Send welcome email with Student ID
  try { sendWelcomeEmail(b.fullName, b.email, b.classId, newId); } catch(e) { Logger.log('Welcome email err: '+e); }
  return {success:true, studentId: newId};
}
function sendOTP(b) {
  const u = toRows(sh('Users')).find(x=>x.Email===b.email);
  if (!u) return {success:false, message:'Email not found.'};
  const otp = String(Math.floor(100000+Math.random()*900000));
  PropertiesService.getScriptProperties().setProperty('OTP_'+b.email,
    JSON.stringify({code:otp, expires:Date.now()+600000}));
  GmailApp.sendEmail(b.email,'EduPortal — Password Reset OTP',
    `Hi ${u.FullName},\n\nOTP: ${otp}\n(Valid 10 minutes)\n\n— EduPortal`);
  return {success:true};
}
function resetPassword(b) {
  const raw = PropertiesService.getScriptProperties().getProperty('OTP_'+b.email);
  if (!raw) return {success:false, message:'OTP expired.'};
  const {code,expires}=JSON.parse(raw);
  if (Date.now()>expires) return {success:false, message:'OTP expired.'};
  if (code!==b.otp) return {success:false, message:'Incorrect OTP.'};
  const s=sh('Users'), d=s.getDataRange().getValues();
  const h=d[0].map(x=>String(x).trim());
  const eC=h.indexOf('Email'), pC=h.indexOf('Password');
  for(let i=1;i<d.length;i++) if(d[i][eC]===b.email){s.getRange(i+1,pC+1).setValue(b.newPassword);break;}
  PropertiesService.getScriptProperties().deleteProperty('OTP_'+b.email);
  return {success:true};
}
// ── STUDENT: getStudentData
function getStudentData(b) {
  const {studentEmail, classId} = b;
  const cKey = 'sd_' + classId + '_' + studentEmail.replace(/[@.]/g,'_');
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
  if (recentUndone >= 3) {
    try {
      const user = toRows(sh('Users')).find(u=>u.Email===studentEmail);
      if (user) {
        const key = 'HW_WARN_'+studentEmail+'_'+classId;
        const lastWarn = PropertiesService.getScriptProperties().getProperty(key);
        const now = Date.now();
        if (!lastWarn || now - Number(lastWarn) > 7*86400000) {
          const body = `<p>Dear <strong>${user.FullName}</strong>,</p>
            <p>You have <strong>${recentUndone} overdue homework(s)</strong> that are marked as Undone in class <strong>${classId}</strong>.</p>
            <p>Please complete your pending assignments as soon as possible.</p>`;
          GmailApp.sendEmail(studentEmail, `[EduPortal] Homework Warning — ${classId}`, '',
            {htmlBody: emailWrapper('Homework Warning', 'Nhac bai tap chua nop', body, classId)});
          PropertiesService.getScriptProperties().setProperty(key, String(now));
        }
      }
    } catch(e){ Logger.log('HW warn email err: '+e); }
  }
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
  cachePutIndexed('cls_' + classId, cKey, resultSD);
  return resultSD;
}
// ── TEACHER: getClassNames — chỉ trả về tên class, không đọc data
// Dùng cho dropdown ở login/register/random draw — O(1), không scan Attendance
function getClassNames() {
  const cached = cacheGet('classnames');
  if (cached) { Logger.log('Cache HIT: classnames'); return cached; }
  Logger.log('Cache MISS: classnames');
  const result = { success: true, classes: getClassIds() };
  cachePut('classnames', result);
  return result;
}

// ── TEACHER: getClassList
function buildClassStudents(classId, allUsers) {
  const classNorm = normalizeClass(classId);
  const classUsers = allUsers.filter(u=>normalizeClass(u.Class)===classNorm);
  const attRecs    = readAttendance(classId);
  return classUsers.map(u=>{
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
}
function activeStudentRows() {
  return toRows(sh('Users')).filter(u=>(u.Role||'Student')==='Student' && u.Archived!=='Y');
}
// getClassList({classId}) → just that class (cached per class, dropped by invalidateClass).
// getClassList() with no classId → every class (only sendReport still needs this).
function getClassList(b) {
  const classId = b && b.classId;
  if (classId) {
    const cKey = 'cls_' + classId + '_students';
    const hit = cacheGet(cKey);
    if (hit) { Logger.log('Cache HIT: ' + cKey); return hit; }
    Logger.log('Cache MISS: ' + cKey);
    const res = {success:true, data:[{classId, students: buildClassStudents(classId, activeStudentRows())}]};
    cachePutIndexed('cls_' + classId, cKey, res);
    return res;
  }
  const cached = cacheGet('classlist');
  if (cached) { Logger.log('Cache HIT: classlist'); return cached; }
  Logger.log('Cache MISS: classlist');
  const allUsers = activeStudentRows();
  const data = getClassIds().map(classId=>({classId, students: buildClassStudents(classId, allUsers)}));
  const result = {success:true, data};
  cachePut('classlist', result);
  return result;
}
// Light endpoint for the teacher Overview: class names + student counts. Reads Users only.
function getClassSummary() {
  const cached = cacheGet('classsummary');
  if (cached) { Logger.log('Cache HIT: classsummary'); return cached; }
  Logger.log('Cache MISS: classsummary');
  const counts = {};
  activeStudentRows().forEach(u=>{ const k=normalizeClass(u.Class); counts[k]=(counts[k]||0)+1; });
  const data = getClassIds().map(classId=>({classId, count: counts[normalizeClass(classId)]||0}));
  const result = {success:true, data};
  cachePut('classsummary', result);
  return result;
}
// ── TEACHER: getClassDetail
function getClassDetail(b) {
  const {classId} = b;
  const cKey = 'cls_' + classId + '_detail';
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
  cachePutIndexed('cls_' + classId, cKey, result4);
  return result4;
}
// ── TEACHER: finishSession
function finishSession(b) {
  const {classId, date, dayLabel, homework} = b;
  const fsNorm = normalizeClass(classId);
  const users = toRows(sh('Users')).filter(u=>normalizeClass(u.Class)===fsNorm && (u.Role||'Student')==='Student');
  const isDay0 = (dayLabel||'').trim().toLowerCase().replace(/ /g,'') === 'day0'
              || (dayLabel||'').trim() === '0';
  const overrides = b.attOverrides || {};

  // ── Step 1: Write attendance
  const attRows = users.map(u => ({
    email:    u.Email,
    classId,
    date,
    dayLabel: dayLabel||'',
    status:   overrides[u.Email] || 'Present',
    score:    0,
    isDay0,
  }));
  batchWriteAttendance(attRows);

  // ── Step 2: Homework upsert
  if (homework && homework.length) {
    const hws = shOrCreate('Homework_Master',
      ['ClassID','SessionDate','DayLabel','Type','Content','Deadline','AssignedBy']);
    const hwData = hws.getDataRange().getValues();
    const hwH = hwData[0].map(x=>String(x).trim());
    const cC2=hwH.indexOf('ClassID'), dC2=hwH.indexOf('SessionDate'),
          tC2=hwH.indexOf('Type'), ctC=hwH.indexOf('Content'), dlC=hwH.indexOf('Deadline');
    const toAppend = [];
    homework.forEach(hw => {
      if (!hw.content) return;
      const hwDate = hw.sessionDate || date;
      let found = -1;
      for (let i=1; i<hwData.length; i++) {
        if (String(hwData[i][cC2]).trim()===classId &&
            fmtDate(hwData[i][dC2])===hwDate &&
            String(hwData[i][tC2]).trim()===(hw.type||'')) {
          found = i; break;
        }
      }
      if (found >= 0) {
        hws.getRange(found+1, ctC+1).setValue(hw.content);
        if (hw.deadline) hws.getRange(found+1, dlC+1).setValue(hw.deadline);
      } else {
        toAppend.push([classId, hwDate, dayLabel||'', hw.type||'', hw.content, hw.deadline||'', 'Teacher']);
      }
      scheduleReminder(classId, hw, users);
    });
    if (toAppend.length) {
      hws.getRange(hws.getLastRow()+1, 1, toAppend.length, toAppend[0].length).setValues(toAppend);
    }
  }

  // ── Step 3: Tuition reminder — queue jobs, send after 15h delay via trigger
  if (!isDay0) {
    const allAtt = readAttendance(classId);
    const jobsToQueue = [];

    users.forEach(u => {
      const myAtt = allAtt.filter(r =>
        r.email === u.Email &&
        r.dayLabel.toLowerCase().replace(/ /g,'') !== 'day0' &&
        r.dayLabel.trim() !== '0'
      );
      const cnt = myAtt.length;
      if (cnt <= 0) return;

      const sessInCycle = cnt % 8;
      const completedMonths = Math.floor(cnt / 8);

      const TRIGGER_SESSIONS = [4, 0];
      if (!TRIGGER_SESSIONS.includes(sessInCycle)) return;
      const triggerLabel = sessInCycle === 0 ? 8 : sessInCycle;

      const payments = getTuitionPayments(classId, u.Email);
      const unpaidMonths = [];
      for (let mo = 1; mo <= completedMonths; mo++) {
        if (!payments[String(mo)]) unpaidMonths.push(mo);
      }
      if (!unpaidMonths.length) return;

      // Rate-limit key — same as before
      const propKey = 'TUI_'+classId+'_'+u.Email+'_S'+triggerLabel+'_C'+completedMonths;
      if (PropertiesService.getScriptProperties().getProperty(propKey)) return;

      // Queue this student's job
      jobsToQueue.push({
        name:         u.FullName,
        email:        u.Email,
        classId:      classId,
        unpaidMonths: unpaidMonths,
        totalSess:    cnt,
        triggerLabel: triggerLabel,
        propKey:      propKey,
      });
    });

    if (jobsToQueue.length > 0) {
      queueTuitionReminderJobs(classId, date, jobsToQueue);
    }
  }

  invalidateClass(classId);
  return {success:true};
}
// ── TEACHER: updateAttendance
function updateAttendance(b) {
  const {classId, studentEmail, sessionDate, status, dayLabel} = b;
  writeAttendance(studentEmail, classId, sessionDate, dayLabel||'', status, null);
  checkAbsenceAlert(classId, studentEmail);
  invalidateClass(classId);
  return {success:true};
}
// ── TEACHER: updateScore (single)
function updateScore(b) {
  const {classId, studentEmail, sessionDate, score} = b;
  writeAttendance(studentEmail, classId, sessionDate, null, null, Number(score));
  return {success:true};
}
// ── TEACHER: batchUpdateScores
function batchUpdateScores(b) {
  const {classId, scores} = b;
  if (!scores || !scores.length) return {success:true};
  clearAttendanceMemo();
  const s = sh('Attendance_Master');
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('StudentEmail'), cC=h.indexOf('ClassID'),
        dC=h.indexOf('SessionDate'), scC=h.indexOf('ParticipationScore');
  scores.forEach(sc => {
    for (let i=1; i<d.length; i++) {
      if (d[i][eC]===sc.studentEmail && d[i][cC]===classId && fmtDate(d[i][dC])===sc.sessionDate) {
        s.getRange(i+1, scC+1).setValue(Number(sc.score)||0);
        break;
      }
    }
  });
  invalidateClass(classId);
  return {success:true};
}
// ── TEACHER: addHomework
function addHomework(b) {
  const {classId, sessionDate, dayLabel, type, content, deadline, isExtra} = b;
  const s = shOrCreate('Homework_Master',
    ['ClassID','SessionDate','DayLabel','Type','Content','Deadline','AssignedBy']);
  const effectiveDayLabel = isExtra ? 'EXTRA' : (dayLabel||'');
  const effectiveDate = isExtra ? '' : (sessionDate||'');
  // Upsert on the same key getHomeworkTracker dedups by (date+type, or EXTRA+deadline+type),
  // so a retried request updates the row instead of appending a duplicate
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const cC=h.indexOf('ClassID'), dC=h.indexOf('SessionDate'), tC=h.indexOf('Type'),
        ctC=h.indexOf('Content'), dlC=h.indexOf('Deadline');
  let found = -1;
  for (let i=1; i<d.length; i++) {
    if (String(d[i][cC]).trim()!==classId || String(d[i][tC]).trim()!==(type||'')) continue;
    const rowDate = fmtDate(d[i][dC]);
    if (isExtra ? (!rowDate && fmtDate(d[i][dlC])===(deadline||'')) : (rowDate===effectiveDate)) { found = i; break; }
  }
  if (found >= 0) {
    s.getRange(found+1, ctC+1).setValue(content);
    if (deadline) s.getRange(found+1, dlC+1).setValue(deadline);
  } else {
    s.appendRow([classId, effectiveDate, effectiveDayLabel, type||'', content, deadline||'', 'Teacher']);
  }
  const ahNorm = normalizeClass(classId);
  const users = toRows(sh('Users')).filter(u=>normalizeClass(u.Class)===ahNorm && (u.Role||'Student')==='Student');
  scheduleReminder(classId, {type, content, deadline, sessionDate: effectiveDate, isExtra}, users);
  invalidateClass(classId);
  return {success:true};
}
// ── Email Templates
function emailWrapper(titleEn, titleVi, bodyHtml, classId) {
  var brandName = classId || 'EduPortal';
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>'
    + '<body style="margin:0;padding:0;background:#f5f4f1;font-family:Arial,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0">'
    + '<tr><td align="center" style="padding:32px 16px;">'
    + '<table width="580" cellpadding="0" cellspacing="0" style="background:white;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);">'
    + '<tr><td style="background:#E01A22;padding:28px 32px;">'
    + '<div style="display:inline-block;background:rgba(255,255,255,.15);border-radius:8px;padding:6px 14px;margin-bottom:12px;">'
    + '<span style="color:white;font-size:16px;font-weight:800;letter-spacing:.5px">' + brandName + '</span></div>'
    + '<p style="margin:0;color:white;font-size:16px;font-weight:700;">' + titleEn + '</p>'
    + '<p style="margin:4px 0 0;color:rgba(255,255,255,.75);font-size:13px;">' + titleVi + '</p>'
    + '</td></tr>'
    + '<tr><td style="padding:32px 32px 24px;">' + bodyHtml + '</td></tr>'
    + '<tr><td style="background:#f5f4f1;padding:16px 32px;border-top:1px solid #e2e0dc;">'
    + '<p style="margin:0;color:#9d9b96;font-size:11px;text-align:center;">'
    + 'Automated message from EduPortal &nbsp;|&nbsp; Email tu dong tu EduPortal.<br>'
    + 'Please do not reply directly to this email.'
    + '</p></td></tr>'
    + '</table></td></tr></table></body></html>';
}
function highlight(text) {
  return '<strong style="color:#E01A22">' + text + '</strong>';
}
function infoBox(rows) {
  const cells = rows.map(function(r) {
    return '<tr>'
      + '<td style="padding:8px 14px;font-size:12px;color:#5c5a56;width:140px;border-bottom:1px solid #f0eeec;white-space:nowrap">' + r[0] + '</td>'
      + '<td style="padding:8px 14px;font-size:13px;font-weight:700;color:#1a1916;border-bottom:1px solid #f0eeec">' + r[1] + '</td>'
      + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;background:#fafaf8;border-radius:8px;overflow:hidden;border:1px solid #e8e6e2;margin:16px 0">' + cells + '</table>';
}
function divider() {
  return '<div style="margin:28px 0 20px;text-align:center">'
    + '<div style="border-top:2px solid #f0eeec;position:relative;margin-bottom:0">'
    + '<span style="display:inline-block;position:relative;top:-11px;background:white;padding:0 14px;color:#9d9b96;font-size:11px;letter-spacing:1px;font-weight:600">'
    + 'Tiếng Việt / VIETNAMESE</span>'
    + '</div></div>';
}
function typeNameVi(type) {
  const m = {W:'Writing',L:'Listening',S:'Speaking',V:'Vocabulary',R:'Reading',G:'Grammar'};
  return m[type]||type;
}
function formatPaymentMethod(note) {
  if (!note) return '';
  const n = note.toLowerCase().trim();
  if (n === 'bank' || n.includes('bank') || n.includes('transfer') || n.includes('chuyen khoan'))
    return 'Bank transfer / Chuyển khoản ngân hàng';
  if (n === 'cash' || n.includes('cash') || n.includes('tien mat') || n.includes('tiền mặt'))
    return 'Cash / Tiền mặt';
  return note;
}
function britDate(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (!d||String(d).length<10) return d||'';
  const s = String(d);
  return parseInt(s.slice(8)) + '-' + months[parseInt(s.slice(5,7))-1] + '-' + s.slice(0,4);
}
// ── Homework Reminder
function scheduleReminder(classId, hw, users) {
  if (!hw.deadline || !hw.content) return;
  const reminderDate = new Date(hw.deadline+'T00:00:00');
  reminderDate.setDate(reminderDate.getDate()-1);
  reminderDate.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  const hwWithExtra = Object.assign({}, hw, {isExtra: !!hw.isExtra});
  if (reminderDate.getTime()===today.getTime()) {
    // Guard against a retried request (the frontend retries finishSession/addHomework
    // when the response leg 404s after doPost already ran) sending the same emails twice
    const sentKey = 'hwsent_'+classId+'_'+(hw.isExtra?'EXTRA_':'')+((hw.sessionDate||hw.deadline)||'')+'_'+(hw.type||'X');
    const cache = CacheService.getScriptCache();
    if (cache.get(sentKey)) { Logger.log('scheduleReminder: already sent today, skipping ' + sentKey); return; }
    cache.put(sentKey, '1', 21600);
    sendHWReminderEmails(hwWithExtra, users, 1, classId);
    return;
  }
  const propKey = 'HW_'+classId+'_'+(hw.isExtra?'EXTRA_':'')+((hw.sessionDate||hw.deadline)||'')+'_'+(hw.type||'X');
  // Don't overwrite if already scheduled (prevents double-send from duplicate calls)
  if (PropertiesService.getScriptProperties().getProperty(propKey)) {
    Logger.log('scheduleReminder: already scheduled, skipping ' + propKey);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    propKey,
    JSON.stringify({hw: hwWithExtra, classId: classId, reminderDate: reminderDate.toISOString(), daysBefore: 1,
      students: users.map(u=>({email:u.Email||u.email, name:u.FullName||u.name}))}));
}
function sendHWReminderEmails(hw, users, daysBefore, classId) {
  classId = classId || hw.classId || '';
  const typeName = typeNameVi(hw.type);
  const extraLabel = hw.isExtra ? '[Extra] ' : '';
  const deadlineDisp = britDate(hw.deadline);
  const daysTextEn = daysBefore===1 ? 'tomorrow' : 'in ' + daysBefore + ' days';
  const daysTextVi = daysBefore===1 ? 'vao ngay mai' : 'trong ' + daysBefore + ' ngay nua';
  users.forEach(function(u) {
    const email = u.Email||u.email;
    if (isStudentArchived(email)) {
      Logger.log('sendHWReminder: skip archived student ' + email);
      return;
    }
    const name = u.FullName||u.name||'Student';
    const contentHtml = String(hw.content||'').replace(/\n/g,'<br>');
    const body = ''
      + '<p style="font-size:15px;color:#1a1916;margin:0 0 16px">Dear ' + highlight(name) + ',</p>'
      + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
      + 'Your ' + highlight(typeName) + ' homework is due ' + highlight(daysTextEn + ' (' + deadlineDisp + ')') + '. '
      + 'Please complete and submit before the deadline.</p>'
      + infoBox([
          ['Class', highlight(classId||'EduPortal')],
          ['Skill', highlight(typeName)],
          ['Assignment', contentHtml],
          ['Deadline', highlight(deadlineDisp)],
        ])
      + divider()
      + '<p style="font-size:15px;color:#1a1916;margin:16px 0">Xin chao ' + highlight(name) + ',</p>'
      + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
      + 'Bai ' + highlight(typeName) + ' cua ban se den han ' + daysTextVi + ' (' + deadlineDisp + '). '
      + 'Vui long hoan thanh va nop bai truoc thoi han.</p>'
      + infoBox([
          ['Lop / Class', highlight(classId||'EduPortal')],
          ['Ky nang', highlight(typeName)],
          ['Noi dung', contentHtml],
          ['Han nop bai', highlight(deadlineDisp)],
        ]);
    try {
      GmailApp.sendEmail(
        u.Email||u.email,
        '[EduPortal] ' + (classId ? classId + ' — ' : '') + typeName + ' due ' + deadlineDisp,
        '',
        {htmlBody: emailWrapper(extraLabel + typeName + ' Homework Reminder', 'Nhac bai tap ' + (hw.isExtra ? '(Extra) ' : '') + typeName, body, classId)}
      );
    } catch(e) { Logger.log(e); }
  });
}
function dailyHomeworkReminder() {
  const today = fmtDate(new Date());
  const props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).filter(function(k){return k.startsWith('HW_');}).forEach(function(key){
    const d = JSON.parse(props[key]);
    if (fmtDate(new Date(d.reminderDate))===today) {
      sendHWReminderEmails(d.hw, d.students, d.daysBefore||1, d.classId||"");
      PropertiesService.getScriptProperties().deleteProperty(key);
    }
  });
}
// ── Tuition Reminder (sent to student)
// triggerSession: 4, 6, or 8 — which session of the new cycle triggered this
// totalUnpaid: how many months are unpaid (for escalating urgency)
// ── Queue tuition reminder jobs + schedule 15h delayed trigger
function queueTuitionReminderJobs(classId, sessionDate, jobs) {
  const props = PropertiesService.getScriptProperties();

  // Store job under fixed key (no timestamp = no duplicates)
  const jobKey = 'TUIJOB_' + classId + '_' + sessionDate;
  props.setProperty(jobKey, JSON.stringify({
    classId, sessionDate, jobs, queuedAt: Date.now(),
  }));

  // NO dynamic trigger creation — processDelayedTuitionReminders runs on a
  // fixed every-3h schedule (set in setupDailyTrigger).
  // This avoids hitting Google's 20-trigger quota limit.
  Logger.log('Queued ' + jobs.length + ' tuition reminder(s) for ' + classId + '. Key: ' + jobKey);
}

// ── Process all pending tuition reminder jobs (called by time-based trigger after 15h)
function processDelayedTuitionReminders() {
  const props = PropertiesService.getScriptProperties();

  // Atomic lock: prevent concurrent executions (race condition)
  const lockKey = 'TUIJOB_PROCESSING_LOCK';
  const existing = props.getProperty(lockKey);
  if (existing && Date.now() - Number(existing) < 10 * 60 * 1000) {
    // Another instance is already running (within last 10 min), skip
    Logger.log('processDelayedTuitionReminders: already running, skipping');
    cleanupTuitionTriggers();
    return;
  }
  props.setProperty(lockKey, String(Date.now()));

  const allProps = props.getProperties();

  // Find all queued jobs
  const jobKeys = Object.keys(allProps).filter(k => k.startsWith('TUIJOB_') && !k.includes('PROCESSING_LOCK'));
  if (!jobKeys.length) {
    props.deleteProperty(lockKey);
    return;
  }

  jobKeys.forEach(jobKey => {
    let batch;
    try { batch = JSON.parse(allProps[jobKey]); } catch(e) { props.deleteProperty(jobKey); return; }

    const { classId, sessionDate, jobs } = batch;
    const sentSummary = []; // collect for teacher digest

    jobs.forEach(job => {
      // Re-check: student may have been archived since job was queued
      if (isStudentArchived(job.email)) {
        Logger.log('Skipping ' + job.email + ' — student is archived');
        return;
      }

      // Re-check: student may have paid in the 15h window
      const currentPayments = getTuitionPayments(job.classId, job.email);
      const stillUnpaid = job.unpaidMonths.filter(mo => !currentPayments[String(mo)]);

      if (!stillUnpaid.length) {
        Logger.log('Skipping ' + job.email + ' — paid in the meantime');
        return;
      }

      // Mark rate-limit key BEFORE sending to prevent duplicates
      props.setProperty(job.propKey, String(Date.now()));

      // Send reminder to student
      sendTuitionReminderEmail(job.name, job.email, job.classId, stillUnpaid, job.totalSess, job.triggerLabel);

      sentSummary.push({
        name:         job.name,
        email:        job.email,
        unpaidMonths: stillUnpaid,
        triggerLabel: job.triggerLabel,
      });
    });

    // Send digest email to teacher if any reminders were sent
    if (sentSummary.length > 0) {
      sendTuitionReminderDigestToTeacher(classId, sessionDate, sentSummary);
    }

    // Clean up job
    props.deleteProperty(jobKey);
    Logger.log('Processed job ' + jobKey + ': ' + sentSummary.length + ' emails sent');
  });

  // Release lock and clean up triggers
  props.deleteProperty(lockKey);
  Logger.log('processDelayedTuitionReminders complete');
}

// ── Delete processDelayedTuitionReminders triggers that have already fired
function cleanupTuitionTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processDelayedTuitionReminders')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// ── Teacher digest email: summary of all tuition reminders sent after a session
function sendTuitionReminderDigestToTeacher(classId, sessionDate, sentSummary) {
  const dateDisp = britDate(sessionDate);
  const now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd-MMM-yyyy HH:mm');

  // Build rows for each student
  const rows = sentSummary.map(s => {
    const monthsStr = s.unpaidMonths.map(m => 'Thang ' + m).join(', ');
    const tone = s.unpaidMonths.length >= 3 ? 'Canh bao (3+ thang)'
               : s.unpaidMonths.length === 2 ? 'Khan cap (2 thang)'
               : 'Nhac nho (1 thang)';
    return '<tr>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f0eeec;font-size:13px">' + s.name + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f0eeec;font-size:12px;color:#5c5a56">' + s.email + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f0eeec;font-size:12px;font-weight:700;color:#d97706">' + monthsStr + '</td>'
      + '<td style="padding:8px 12px;border-bottom:1px solid #f0eeec;font-size:11px;color:#9d9b96">' + tone + '</td>'
      + '</tr>';
  }).join('');

  const tableHtml = '<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0">'
    + '<thead><tr style="background:#f5f4f1">'
    + '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#5c5a56">Ho ten</th>'
    + '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#5c5a56">Email</th>'
    + '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#5c5a56">Thang chua dong</th>'
    + '<th style="padding:8px 12px;text-align:left;font-size:11px;color:#5c5a56">Muc do</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>';

  const body = ''
    + '<p style="font-size:14px;color:#1a1916;margin:0 0 8px">Sau buoi hoc ngay <strong>' + dateDisp + '</strong> cua lop <strong>' + classId + '</strong>, '
    + 'he thong da gui mail nhac hoc phi den <strong>' + sentSummary.length + ' sinh vien</strong>:</p>'
    + tableHtml
    + '<p style="font-size:12px;color:#9d9b96;margin:16px 0 0">Da gui luc: ' + now + '</p>';

  try {
    GmailApp.sendEmail(
      REPORT_EMAIL,
      '[EduPortal] Tong hop nhac hoc phi — ' + classId + ' — ' + dateDisp + ' (' + sentSummary.length + ' SV)',
      '',
      { htmlBody: emailWrapper('Tuition Reminder Digest — ' + classId, 'Tong hop nhac hoc phi', body, classId) }
    );
    Logger.log('Digest sent to teacher: ' + REPORT_EMAIL);
  } catch(e) { Logger.log('Digest email error: ' + e); }
}

function sendTuitionReminderEmail(name, email, classId, unpaidMonths, totalSess, triggerSession) {
  // unpaidMonths: array of month numbers e.g. [7, 8] or [8]
  if (!Array.isArray(unpaidMonths)) unpaidMonths = [unpaidMonths]; // backward compat
  triggerSession = triggerSession || 4;
  const totalUnpaid = unpaidMonths.length;

  // Tone based on number of unpaid months
  let subjectTag, statusColor;
  if (totalUnpaid >= 3) {
    subjectTag  = 'Canh bao hoc phi';
    statusColor = '#dc2626';
  } else if (totalUnpaid === 2) {
    subjectTag  = 'Nhac hoc phi (khan cap)';
    statusColor = '#d97706';
  } else {
    subjectTag  = 'Nhac hoc phi';
    statusColor = '#d97706';
  }

  // Month list for display: "Tháng 7, 8" or "Tháng 8"
  const monthListEn = unpaidMonths.map(m => 'Month ' + m).join(', ');
  const monthListVi = 'Tháng ' + unpaidMonths.join(', ');

  // Intro paragraph
  const sessionContext = `session ${triggerSession}/8 of the current month`;
  let introEn, introVi, warningBlock;

  if (totalUnpaid >= 3) {
    introEn = `You have reached ${sessionContext} in class ${highlight(classId)}. Our records show that tuition for <strong>${monthListEn}</strong> (${totalUnpaid} months) has not been completed.`;
    introVi = `Bạn đã đến buổi ${triggerSession}/8 của tháng hiện tại trong lớp ${highlight(classId)}. Hồ sơ cho thấy học phí <strong>${monthListVi}</strong> (${totalUnpaid} tháng) chưa hoàn thành.`;
    warningBlock = `<div style="margin:16px 0;padding:14px 16px;background:#fff1f1;border-radius:8px;border-left:4px solid #dc2626;">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#dc2626;">⚠ Notice / Thông báo</p>
      <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.7;">
        Your enrollment may be paused until at least <strong>2 months</strong> of outstanding tuition are settled.<br><br>
        Việc học của bạn có thể bị tạm dừng nếu không hoàn thành ít nhất <strong>2 tháng</strong> học phí còn thiếu.
      </p>
    </div>`;
  } else if (totalUnpaid === 2) {
    introEn = `You have reached ${sessionContext} in class ${highlight(classId)}. Tuition for <strong>${monthListEn}</strong> has not been completed yet.`;
    introVi = `Bạn đã đến buổi ${triggerSession}/8 của tháng hiện tại trong lớp ${highlight(classId)}. Học phí <strong>${monthListVi}</strong> chưa hoàn thành.`;
    warningBlock = `<p style="font-size:13px;color:#dc2626;font-weight:700;margin:12px 0 0;padding:10px 14px;background:#fff1f1;border-radius:6px;border-left:3px solid #dc2626;">
      ⚠ You have <strong>${totalUnpaid} months</strong> of tuition not yet completed. Please prioritise settling these.<br>
      ⚠ Bạn có <strong>${totalUnpaid} tháng</strong> học phí chưa hoàn thành. Vui lòng ưu tiên thanh toán sớm.
    </p>`;
  } else {
    introEn = `You have reached ${sessionContext} in class ${highlight(classId)}. This is a reminder that tuition for <strong>${monthListEn}</strong> has not been completed.`;
    introVi = `Bạn đã đến buổi ${triggerSession}/8 của tháng hiện tại trong lớp ${highlight(classId)}. Đây là nhắc nhở rằng học phí <strong>${monthListVi}</strong> chưa hoàn thành.`;
    warningBlock = '';
  }

  // Info table rows — one row per unpaid month
  const monthRows = unpaidMonths.map(m =>
    ['Tháng / Month ' + m, `<span style="color:${statusColor};font-weight:700;">Chưa hoàn thành / Unpaid</span>`]
  );

  const body = ''
    + `<p style="font-size:15px;color:#1a1916;margin:0 0 16px">Dear ${highlight(name)},</p>`
    + `<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 8px">${introEn}</p>`
    + warningBlock
    + infoBox([
        ['Class', highlight(classId)],
        ['Session / Buổi', triggerSession + '/8 of current month'],
      ].concat(monthRows))
    + divider()
    + `<p style="font-size:15px;color:#1a1916;margin:16px 0">Xin chào ${highlight(name)},</p>`
    + `<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 8px">${introVi}</p>`;

  const monthsDesc = totalUnpaid > 1 ? `${totalUnpaid} tháng (${unpaidMonths.join(', ')})` : monthListVi;
  const subject = `[EduPortal] ${subjectTag} — ${monthsDesc} / ${classId}`;

  try {
    GmailApp.sendEmail(email, subject, '', {
      htmlBody: emailWrapper(
        'Tuition Reminder — ' + (totalUnpaid > 1 ? totalUnpaid + ' months' : monthListEn),
        'Nhac hoc phi — ' + monthsDesc,
        body,
        classId
      )
    });
    Logger.log('Tuition reminder sent: '+email+' months='+unpaidMonths.join(',')+' S'+triggerSession);
  } catch(e) { Logger.log(e); }
}

// ── Tuition Paid Confirmation (sent to student)
function sendTuitionPaidEmail(name, email, classId, monthNo, paidDate, note) {
  const dateDisp = britDate(paidDate);
  const payMethod = formatPaymentMethod(note);
  const noteRow = payMethod ? [['Phương thức / Method', payMethod]] : [];
  const body = ''
    + '<p style="font-size:15px;color:#1a1916;margin:0 0 16px">Dear ' + highlight(name) + ',</p>'
    + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
    + 'Your tuition payment for ' + highlight('Month ' + monthNo) + ' in class ' + highlight(classId) + ' has been confirmed. Thank you!</p>'
    + infoBox([
        ['Class', highlight(classId)],
        ['Month / Tháng', highlight('Month ' + monthNo)],
        ['Date / Ngày', dateDisp],
        ['Status / Trạng thái', '<span style="color:#16a34a;font-weight:700">Confirmed / Đã xác nhận</span>'],
      ].concat(noteRow))
    + divider()
    + '<p style="font-size:15px;color:#1a1916;margin:16px 0">Xin chào ' + highlight(name) + ',</p>'
    + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
    + 'Học phí ' + highlight('Tháng ' + monthNo) + ' của bạn trong lớp ' + highlight(classId) + ' đã được xác nhận. Cảm ơn bạn!</p>';
  try {
    GmailApp.sendEmail(
      email,
      '[EduPortal] Payment confirmed — Month ' + monthNo + ' / Xác nhận học phí Tháng ' + monthNo,
      '',
      {htmlBody: emailWrapper('Payment Confirmed — Month ' + monthNo, 'Xac nhan hoc phi Thang ' + monthNo, body, classId)}
    );
  } catch(e) { Logger.log(e); }
}
// ── NEW: Tuition Paid Confirmation for TEACHER
function sendTuitionPaidConfirmToTeacher(studentName, studentEmail, classId, monthNo, paidDate, note) {
  const dateDisp = britDate(paidDate);
  const payMethod = formatPaymentMethod(note);
  const noteRow = payMethod ? [['Phương thức / Method', payMethod]] : [];
  const now = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'dd-MMM-yyyy HH:mm');

  const body = ''
    + '<p style="font-size:15px;color:#1a1916;margin:0 0 8px">Xác nhận thanh toán học phí vừa được ghi nhận:</p>'
    + infoBox([
        ['Học sinh / Student', highlight(studentName)],
        ['Email', studentEmail],
        ['Lớp / Class',        highlight(classId)],
        ['Tháng / Month',      highlight('Month ' + monthNo)],
        ['Ngày đóng / Date',   highlight(dateDisp)],
        ['Trạng thái / Status','<span style="color:#16a34a;font-weight:700">✓ Đã đóng / Paid</span>'],
      ].concat(noteRow).concat([['Ghi nhận lúc', now]]))
    + '<p style="font-size:12px;color:#9d9b96;margin:16px 0 0">'
    + 'Email này được gửi tự động để giúp bạn đối chiếu hồ sơ. Vui lòng lưu lại nếu cần.</p>';

  try {
    GmailApp.sendEmail(
      REPORT_EMAIL,
      '[EduPortal] Xac nhan hoc phi — ' + studentName + ' | ' + classId + ' | Thang ' + monthNo,
      '',
      {htmlBody: emailWrapper('Payment Recorded — ' + classId, 'Xac nhan da nhan hoc phi', body, classId)}
    );
    Logger.log('Teacher confirm email sent for: '+studentName+' M'+monthNo);
  } catch(e) { Logger.log('Teacher confirm email err: '+e); }
}
function checkAbsenceAlert(classId, studentEmail) {
  try {
    const myAtt  = readAttendance(classId, studentEmail);
    const recent = myAtt.slice(-8);
    if (recent.filter(r=>r.status==='Absent').length>=3) {
      const user = toRows(sh('Users')).find(u=>u.Email===studentEmail);
      if (user) GmailApp.sendEmail(user.Email,'EduPortal — Attendance Warning',
        `Hi ${user.FullName},\nYou have 3+ absences in your last 8 sessions.\n— EduPortal`);
    }
  } catch(e){Logger.log(e);}
}
// ── sendReport
function sendReport() {
  try {
    const {data} = getClassList();
    const month  = Utilities.formatDate(new Date(),'Asia/Ho_Chi_Minh','MMMM yyyy');
    let rows_html = '';
    data.forEach(cls=>cls.students.forEach(s=>{
      rows_html += `<tr>
        <td style="padding:9px 13px;border-bottom:1px solid #eee">${s.name}</td>
        <td style="padding:9px 13px;border-bottom:1px solid #eee">${s.class}</td>
        <td style="padding:9px 13px;border-bottom:1px solid #eee;font-weight:700">${s.monthsUsed}</td>
        <td style="padding:9px 13px;border-bottom:1px solid #eee;color:#16a34a">${s.present}</td>
        <td style="padding:9px 13px;border-bottom:1px solid #eee;color:#ca8a04">${s.late}</td>
        <td style="padding:9px 13px;border-bottom:1px solid #eee;color:#dc2626">${s.absent}</td>
      </tr>`;
    }));
    GmailApp.sendEmail(REPORT_EMAIL,'EduPortal — Monthly Report '+month,'',{htmlBody:
      `<div style="font-family:Arial;max-width:700px">
       <div style="background:#E01A22;padding:24px;border-radius:10px 10px 0 0">
         <h1 style="color:white;margin:0">EduPortal — ${month}</h1></div>
       <div style="background:white;padding:16px;border-radius:0 0 10px 10px">
         <table style="width:100%;border-collapse:collapse;font-size:13px">
           <thead><tr style="background:#f5f5f5">
             <th style="padding:9px 13px;text-align:left">Student</th>
             <th style="padding:9px 13px;text-align:left">Class</th>
             <th style="padding:9px 13px;text-align:left">Months</th>
             <th style="padding:9px 13px;text-align:left">Present</th>
             <th style="padding:9px 13px;text-align:left">Late</th>
             <th style="padding:9px 13px;text-align:left">Absent</th>
           </tr></thead>
           <tbody>${rows_html}</tbody>
         </table></div></div>`});
    return {success:true};
  } catch(e) { return {success:false, message:e.toString()}; }
}
// ── Archive helpers
// Check nhanh trong Archived_Users — dùng để chặn email gửi nhầm
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

// Xóa pending reminder jobs (HW + tuition) khi archive student
// Ngăn email tiếp tục gửi sau khi đã xóa khỏi lớp
function cleanupStudentReminderJobs(email) {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();

    // HW reminder jobs: key = HW_classId_..., value = {hw, students:[{email,name}]}
    Object.keys(all).filter(k => k.startsWith('HW_')).forEach(key => {
      try {
        const job = JSON.parse(all[key]);
        if (!job.students) return;
        const filtered = job.students.filter(s => (s.email || s.Email) !== email);
        if (filtered.length === 0) {
          props.deleteProperty(key);
        } else if (filtered.length !== job.students.length) {
          job.students = filtered;
          props.setProperty(key, JSON.stringify(job));
        }
      } catch(e) { Logger.log('cleanupHWJob err: ' + e); }
    });

    // Tuition rate-limit keys: TUI_classId_email_S..._C...
    Object.keys(all)
      .filter(k => k.startsWith('TUI_') && k.includes('_' + email + '_'))
      .forEach(k => props.deleteProperty(k));

    // Tuition batch jobs: TUIJOB_classId_date → filter jobs array
    Object.keys(all).filter(k => k.startsWith('TUIJOB_') && !k.includes('PROCESSING_LOCK')).forEach(key => {
      try {
        const batch = JSON.parse(all[key]);
        if (!batch.jobs) return;
        const filtered = batch.jobs.filter(j => j.email !== email);
        if (filtered.length === 0) {
          props.deleteProperty(key);
        } else if (filtered.length !== batch.jobs.length) {
          batch.jobs = filtered;
          props.setProperty(key, JSON.stringify(batch));
        }
      } catch(e) { Logger.log('cleanupTUIJob err: ' + e); }
    });

    Logger.log('Cleaned up reminder jobs for archived: ' + email);
  } catch(e) { Logger.log('cleanupStudentReminderJobs err: ' + e); }
}

// ── Archive student
function archiveStudent(b) {
  const {email, archive} = b;
  const ss = SS();
  if(archive) {
    const src = sh('Users');
    const dst = shOrCreate('Archived_Users', null);
    const d = src.getDataRange().getValues();
    const h = d[0].map(x=>String(x).trim());
    const eC = h.indexOf('Email');
    if(dst.getLastRow()===0) dst.appendRow(d[0]);
    for(let i=1;i<d.length;i++){
      if(d[i][eC]===email){
        const cIdx = h.indexOf('Class');
        const oldClass = cIdx>=0 ? String(d[i][cIdx]||'').trim() : '';
        dst.appendRow([...d[i], fmtDate(new Date())]);
        src.deleteRow(i+1);
        cleanupStudentReminderJobs(email); // chặn email tiếp tục gửi
        invalidateSummary(); if (oldClass) invalidateClass(oldClass);
        return {success:true};
      }
    }
    return {success:false,message:'Student not found'};
  } else {
    const src = shOrCreate('Archived_Users', null);
    const dst = sh('Users');
    const d = src.getDataRange().getValues();
    const h = d[0].map(x=>String(x).trim());
    const eC = h.indexOf('Email');
    for(let i=1;i<d.length;i++){
      if(d[i][eC]===email){
        dst.appendRow(d[i].slice(0,7));
        src.deleteRow(i+1);
        invalidateSummary();
        const cIdx2 = h.indexOf('Class');
        if (cIdx2>=0 && d[i][cIdx2]) invalidateClass(String(d[i][cIdx2]).trim());
        return {success:true};
      }
    }
    return {success:false,message:'Student not found in archive'};
  }
}
// ── Archive class
function archiveClass(b) {
  const {classId, archive} = b;
  const ss = SS();
  if(archive) {
    const tab = findClassTab(classId);
    if(!tab) return {success:false, message:'Class tab not found'};
    tab.setName('ARCHIVED_'+classId);
    const users = sh('Users');
    const d = users.getDataRange().getValues();
    const h = d[0].map(x=>String(x).trim());
    const cC = h.indexOf('Class');
    const classVariants = [classId, classId.replace(/ /g,'_'), classId.replace(/_/g,' ')];
    const rowsToArchive = [];
    for(let i=d.length-1;i>=1;i--){
      if(classVariants.includes(String(d[i][cC]).trim())) rowsToArchive.push(i);
    }
    const dst = shOrCreate('Archived_Users', null);
    if(dst.getLastRow()===0) dst.appendRow([...d[0],'ArchivedDate']);
    rowsToArchive.forEach(i=>{
      dst.appendRow([...d[i], fmtDate(new Date())]);
      users.deleteRow(i+1);
    });
    invalidateSummary(); invalidateClass(classId);
    return {success:true};
  } else {
    const tab = ss.getSheetByName('ARCHIVED_'+classId);
    if(!tab) return {success:false, message:'Archived tab not found'};
    tab.setName(classId);
    invalidateSummary(); invalidateClass(classId);
    return {success:true};
  }
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
// ── Tuition Payments
function markTuitionPaid(b) {
  const {classId, studentEmail, monthNo, paid, paidDate, note} = b;
  const s = shOrCreate('Tuition_Payments',
    ['ClassID','StudentEmail','MonthNo','PaidDate','Note']);
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const cC=h.indexOf('ClassID'), eC=h.indexOf('StudentEmail'),
        mC=h.indexOf('MonthNo'), pC=h.indexOf('PaidDate'), nC=h.indexOf('Note');
  return withLock(() => {
  for(let i=1;i<d.length;i++){
    if(d[i][cC]===classId && d[i][eC]===studentEmail && String(d[i][mC])===String(monthNo)){
      if(!paid){ s.deleteRow(i+1); invalidateClass(classId); return {success:true}; }
      s.getRange(i+1,pC+1).setValue(paidDate||fmtDate(new Date()));
      if(note!==undefined) s.getRange(i+1,nC+1).setValue(note||'');
      invalidateClass(classId);
      return {success:true};
    }
  }
  if(paid){
    const finalDate = paidDate || fmtDate(new Date());
    s.appendRow([classId, studentEmail, monthNo, finalDate, note||'']);
    try {
      const user = toRows(sh('Users')).find(u=>u.Email===studentEmail);
      if (user) {
        // Dedup: only send confirmation emails if not sent in last 30 seconds
        const emailDedupKey = 'PAID_EMAIL_' + classId + '_' + studentEmail + '_M' + monthNo;
        const lastSent = PropertiesService.getScriptProperties().getProperty(emailDedupKey);
        const shouldSendEmail = !lastSent || Date.now() - Number(lastSent) > 30000;
        if (shouldSendEmail) {
          PropertiesService.getScriptProperties().setProperty(emailDedupKey, String(Date.now()));
          // Email to student: payment confirmed
          sendTuitionPaidEmail(user.FullName, user.Email, classId, monthNo, finalDate, note||'');
          // Email to teacher: confirmation record for cross-referencing
          sendTuitionPaidConfirmToTeacher(user.FullName, user.Email, classId, monthNo, finalDate, note||'');
        } else {
          Logger.log('Skipping duplicate payment email for ' + studentEmail + ' M' + monthNo);
        }
        // Clear reminder propKeys for this student
        const reminderProps = PropertiesService.getScriptProperties().getProperties();
        const prefix = 'TUI_'+classId+'_'+studentEmail+'_';
        Object.keys(reminderProps).filter(k => k.startsWith(prefix)).forEach(k => {
          PropertiesService.getScriptProperties().deleteProperty(k);
        });
      }
    } catch(e){Logger.log(e);}
  }
  return {success:true};
  }); // end withLock
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
  const cKey = 'cls_' + classId + '_tuition';
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
  cachePutIndexed('cls_' + classId, cKey, result6);
  return result6;
}
// ── getRewardsMonths: chỉ trả về danh sách tháng + dates, không tính attendance/hw
// Dùng để hiển thị list tháng ngay khi chọn lớp
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

// ── getRewardsMonth: load chi tiết 1 tháng duy nhất
// Fix hwDue: đếm số bài tập thực tế (rows trong Homework_Master) của tháng đó
// Không giả định 8 bài/tháng
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

// ── Rewards (legacy — giữ lại cho random draw / backward compat)
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
// ── Delete / Reset attendance
function deleteAttRecord(b) {
  const {studentEmail, sessionDate} = b;
  clearAttendanceMemo();
  const s = sh('Attendance_Master');
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('StudentEmail'), dC=h.indexOf('SessionDate');
  const toDelete = [];
  for(let i=d.length-1;i>=1;i--) {
    if(d[i][eC]===studentEmail && fmtDate(d[i][dC])===sessionDate) toDelete.push(i+1);
  }
  toDelete.forEach(row=>s.deleteRow(row));
  return {success:true, deleted:toDelete.length};
}
function resetAttendance(b) {
  const {studentEmail, classId} = b;
  const recs = readAttendance(classId, studentEmail);
  const byDate = {};
  recs.forEach(r=>{ if(!byDate[r.date]) byDate[r.date]=[]; byDate[r.date].push(r); });
  const duplicates = Object.entries(byDate).filter(([d,arr])=>arr.length>1).map(([d,arr])=>({date:d,count:arr.length}));
  return {success:true, records:recs, duplicates};
}
// ── Student ID System
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
function generateStudentId(className) {
  const code = buildClassCode(className);
  const allUsers = toRows(sh('Users'));
  let archivedUsers = [];
  try { archivedUsers = toRows(sh('Archived_Users')); } catch(e){}
  const existing = [...allUsers, ...archivedUsers]
    .map(u => u.StudentID || '')
    .filter(id => id.startsWith(code + '-'))
    .map(id => parseInt(id.split('-')[1]) || 0);
  const next = existing.length ? Math.max(...existing) + 1 : 1;
  return code + '-' + String(next).padStart(3, '0');
}
function assignAllStudentIds() {
  const s = sh('Users');
  const d = s.getDataRange().getValues();
  const h = d[0].map(x => String(x).trim());
  let idCol = h.indexOf('StudentID');
  if (idCol === -1) {
    s.getRange(1, h.length + 1).setValue('StudentID');
    idCol = h.length;
    h.push('StudentID');
  }
  const byClass = {};
  for (let i = 1; i < d.length; i++) {
    const existing = idCol < d[i].length ? String(d[i][idCol] || '').trim() : '';
    if (existing) continue;
    const cls = String(d[i][h.indexOf('Class')] || '').trim();
    if (!cls) continue;
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(i);
  }
  const codeCounters = {};
  for (let i = 1; i < d.length; i++) {
    const existingId = idCol < d[i].length ? String(d[i][idCol] || '').trim() : '';
    if (!existingId || !existingId.includes('-')) continue;
    const parts = existingId.split('-');
    const code = parts[0], num = parseInt(parts[1]) || 0;
    if (!codeCounters[code] || num > codeCounters[code]) codeCounters[code] = num;
  }
  let assigned = 0;
  Object.keys(byClass).forEach(cls => {
    const code = buildClassCode(cls);
    if (!codeCounters[code]) codeCounters[code] = 0;
    byClass[cls].forEach(rowIdx => {
      codeCounters[code]++;
      const newId = code + '-' + String(codeCounters[code]).padStart(3, '0');
      s.getRange(rowIdx + 1, idCol + 1).setValue(newId);
      assigned++;
    });
  });
  return { success: true, assigned };
}
function getStudentId(b) {
  const users = toRows(sh('Users'));
  const u = users.find(x => x.Email === b.email);
  return { success: !!u, id: u ? (u.StudentID || '') : '' };
}
// ── Homework Tracker
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
  const cKey = 'cls_' + classId + '_hwtracker';
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
      const status = statusIdx>=0 ? (String(r[statusIdx]||'').trim()||'Undone') : 'Undone';
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
  cachePutIndexed('cls_' + classId, cKey, resultHW);
  return resultHW;
}
function saveHomeworkSubmission(b) {
  return withLock(() => {
  const {classId, studentEmail, hwId, sessionDate, type, status, note, deadline} = b;
  const s = getHWMasterSheet();
  const d = s.getDataRange().getValues();
  const headers = d[0].map(x=>String(x).trim());
  const emailKey = studentEmail.replace(/[@.]/g,'_');
  for (let i=1; i<d.length; i++) {
    const rowClassId = String(d[i][0]).trim();
    const rowDate    = fmtDate(d[i][1]);
    const rowType    = String(d[i][3]).trim();
    const rowDL      = fmtDate(d[i][5]);
    const isExtra    = !rowDate;
    if (rowClassId!==classId || rowType!==type) continue;
    if (isExtra) {
      if (fmtDate(deadline) !== rowDL) continue;
    } else {
      if (rowDate !== sessionDate) continue;
    }
    const ensureCol = (key) => {
      let idx = headers.indexOf(key);
      if (idx<0) {
        idx = headers.length;
        s.getRange(1, idx+1).setValue(key);
        headers.push(key);
      }
      return idx;
    };
    const stIdx = ensureCol(emailKey+'_Status');
    const gdIdx = ensureCol(emailKey+'_GradedDate');
    const ntIdx = ensureCol(emailKey+'_Note');
    s.getRange(i+1, stIdx+1).setValue(status||'Undone');
    s.getRange(i+1, gdIdx+1).setValue(fmtDate(new Date()));
    if (note!==undefined) s.getRange(i+1, ntIdx+1).setValue(note||'');
    invalidateClass(classId);
    return {success:true};
  }
  return {success:false, message:'Homework row not found'};
  }); // end withLock
}
// ── Archived students
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
// ── Update homework deadline + reschedule reminder email
function updateHomeworkDeadline(b) {
  const {classId, sessionDate, type, deadline} = b;
  if (!classId || !sessionDate || !type || !deadline)
    return {success:false, message:'Missing required fields.'};
  const s = getHWMasterSheet();
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const cC=h.indexOf('ClassID'), dC=h.indexOf('SessionDate'),
        tC=h.indexOf('Type'), dlC=h.indexOf('Deadline'), ctC=h.indexOf('Content');
  let updated = 0;
  let hwContent = '';
  for (let i=1; i<d.length; i++) {
    if (String(d[i][cC]).trim()===classId &&
        fmtDate(d[i][dC])===sessionDate &&
        String(d[i][tC]).trim()===type) {
      s.getRange(i+1, dlC+1).setValue(deadline);
      if (!hwContent && ctC>=0) hwContent = String(d[i][ctC]||'').trim();
      updated++;
    }
  }
  if (updated > 0) {
    invalidateClassCache(classId);
    // Reschedule HW reminder: delete old job, create new one with updated deadline
    rescheduleHWReminder(classId, sessionDate, type, deadline, hwContent);
  }
  return {success:true, updated};
}

// Reschedule HW reminder when deadline is changed
// Old job key is found by classId+sessionDate+type, replaced with new deadline
function rescheduleHWReminder(classId, sessionDate, type, newDeadline, hwContent) {
  try {
    const props = PropertiesService.getScriptProperties();
    const all = props.getProperties();
    const hwKey = 'HW_' + classId + '_' + sessionDate + '_' + type;
    // Find matching job
    let found = false;
    let foundKey = null;
    let foundJob = null;
    // Try exact key first
    if (all[hwKey]) { foundKey=hwKey; foundJob=JSON.parse(all[hwKey]); found=true; }
    // Fallback: scan all HW_ keys
    if (!found) {
      Object.keys(all).filter(k=>k.startsWith('HW_'+classId)).forEach(key => {
        if (found) return;
        try {
          const job = JSON.parse(all[key]);
          if (job.hw && fmtDate(job.hw.sessionDate||'')===sessionDate && (job.hw.type||'')===type) {
            foundKey=key; foundJob=job; found=true;
          }
        } catch(e){}
      });
    }
    if (found && foundKey && foundJob) {
      // Delete old job
      props.deleteProperty(foundKey);
      Logger.log('Deleted old HW reminder job: '+foundKey);
    }
    // Create new reminder with updated deadline
    if (newDeadline) {
      const classNorm = normalizeClass(classId);
      const users = toRows(sh('Users'))
        .filter(u => normalizeClass(u.Class)===classNorm && (u.Role||'Student')==='Student' && u.Archived!=='Y');
      if (users.length) {
        const hw = { type, content: hwContent||'', sessionDate, deadline: newDeadline };
        scheduleReminder(classId, hw, users);
        Logger.log('Rescheduled HW reminder for '+classId+'/'+sessionDate+'/'+type+' → new deadline: '+newDeadline);
      }
    }
  } catch(e) { Logger.log('rescheduleHWReminder err: '+e); }
}

function invalidateClassCache(classId) {
  // Clear CacheService entries for this class
  try {
    const cache = CacheService.getScriptCache();
    ['_detail','_tuition','_hwtracker','_attmatrix'].forEach(suffix => {
      cache.remove('cls_' + classId + suffix);
    });
    cache.remove('classlist');
  } catch(e) {}
}

function deleteHomework(b) {
  const {classId, sessionDate, type} = b;
  if (!classId || !sessionDate) return {success:false, message:'classId and sessionDate required'};
  const s = getHWMasterSheet();
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const cC=h.indexOf('ClassID'), dC=h.indexOf('SessionDate'), tC=h.indexOf('Type');
  const toDelete = [];
  for (let i=d.length-1; i>=1; i--) {
    if (String(d[i][cC]).trim()===classId &&
        fmtDate(d[i][dC])===sessionDate &&
        (!type || String(d[i][tC]).trim()===type)) {
      toDelete.push(i+1);
    }
  }
  toDelete.forEach(row => s.deleteRow(row));
  invalidateClass(classId);
  return {success:true, deleted:toDelete.length};
}

// ── HW Month Status — track which months are "ended" per class
// Sheet: HW_Month_Status (ClassID, MonthNo, EndedDate)
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

function endHWMonth(b) {
  const {classId, monthNo, reopen} = b;
  try {
    const s = shOrCreate('HW_Month_Status', ['ClassID','MonthNo','EndedDate']);
    const d = s.getDataRange().getValues();
    const h = d[0].map(x=>String(x).trim());
    const cC=h.indexOf('ClassID'), mC=h.indexOf('MonthNo'), eC=h.indexOf('EndedDate');
    for(let i=1;i<d.length;i++){
      if(String(d[i][cC]).trim()===classId && String(d[i][mC]).trim()===String(monthNo)){
        if(reopen){
          // Delete this row — shift rows up
          s.deleteRow(i+1);
          return {success:true, action:'reopened'};
        }
        // Already exists — update date
        s.getRange(i+1,eC+1).setValue(fmtDate(new Date()));
        return {success:true, action:'updated'};
      }
    }
    if(reopen) return {success:true, action:'not_found'}; // nothing to delete
    s.appendRow([classId, monthNo, fmtDate(new Date())]);
    return {success:true, action:'created'};
  } catch(e) { return {success:false, message:e.message}; }
}

// ── Keep-warm: triggered every 8 minutes to reduce GAS cold start
function keepWarm() {
  // Just touch CacheService to keep the instance alive
  try { CacheService.getScriptCache().get('__warm__'); } catch(e) {}
  // Keep the teacher's landing data hot so the first page load never pays a cold read
  try { getClassSummary(); } catch(e) { Logger.log('keepWarm summary err: '+e); }
  Logger.log('Keep-warm ping: ' + new Date().toISOString());
}
function initializeSheets() {
  shOrCreate('Users',              ['FullName','DOB','Email','Phone','Class','Password','Role','StudentID']);
  shOrCreate('Attendance_Master',  ['StudentEmail','ClassID','SessionDate','DayLabel','Status','ParticipationScore','IsDay0']);
  shOrCreate('Homework_Master',    ['ClassID','SessionDate','DayLabel','Type','Content','Deadline','AssignedBy']);
  shOrCreate('Tuition_Payments',   ['ClassID','StudentEmail','MonthNo','PaidDate','Note']);
  shOrCreate('Archived_Users',     ['FullName','DOB','Email','Phone','Class','Password','Role','StudentID','ArchivedDate']);
  Logger.log('✅ All sheets initialized');
}
function setupDailyTrigger() {
  // Remove ALL existing triggers before recreating
  // This prevents trigger accumulation over time
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));

  // Homework reminder at 7am VN
  ScriptApp.newTrigger('dailyHomeworkReminder').timeBased().everyDays(1).atHour(7).create();
  // Pre-populate attendance at 8am VN
  ScriptApp.newTrigger('runPrePopulate').timeBased().everyDays(1).atHour(8).create();
  // Keep GAS + class summary cache warm every 10 minutes (reduces cold start latency)
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
  // Process queued tuition reminder jobs every 3 hours
  // Using fixed schedule instead of dynamic per-session triggers (avoids 20-trigger quota)
  ScriptApp.newTrigger('processDelayedTuitionReminders').timeBased().everyHours(3).create();

  Logger.log('✅ Triggers set: HW reminder 7am + pre-populate 8am + keepWarm 10min + tuition digest 3h');
}
function runPrePopulate() {
  prePopulateAllClassesToday();
}
function prePopulateAllClassesToday() {
  const today = fmtDate(new Date());
  const classIds = getClassIds();
  let totalCreated = 0;
  classIds.forEach(classId => {
    const sched = readSchedule(classId);
    const todaySess = sched.find(s =>
      s.date === today &&
      s.dayLabel.toLowerCase().replace(/ /g,'').replace('day','') !== '0'
    );
    if (!todaySess) return;
    const created = prePopulateSession(classId, today, todaySess.dayLabel);
    totalCreated += created;
    Logger.log(`prePopulate: ${classId} on ${today} → ${created} rows created`);
  });
  Logger.log(`prePopulate done: ${totalCreated} total rows created`);
  return totalCreated;
}
function prePopulateSession(classId, date, dayLabel) {
  const classNorm = normalizeClass(classId);
  const users = toRows(sh('Users')).filter(u =>
    normalizeClass(u.Class) === classNorm &&
    (u.Role || 'Student') === 'Student' &&
    u.Archived !== 'Y'
  );
  if (!users.length) return 0;
  clearAttendanceMemo();
  const s = shOrCreate('Attendance_Master',
    ['StudentEmail','ClassID','SessionDate','DayLabel','Status','ParticipationScore','IsDay0']);
  const d = s.getDataRange().getValues();
  const h = d[0].map(x=>String(x).trim());
  const eC=h.indexOf('StudentEmail'), cC=h.indexOf('ClassID'), dC=h.indexOf('SessionDate');
  const existing = new Set();
  for (let i=1; i<d.length; i++) {
    if (d[i][cC]===classId && fmtDate(d[i][dC])===date) {
      existing.add(d[i][eC]);
    }
  }
  const toAppend = users
    .filter(u => !existing.has(u.Email))
    .map(u => [u.Email, classId, date, dayLabel||'', 'Present', 0, '']);
  if (toAppend.length) {
    s.getRange(s.getLastRow()+1, 1, toAppend.length, 7).setValues(toAppend);
  }
  return toAppend.length;
}
function getArchivedClasses() {
  const sheets = SS().getSheets()
    .filter(s => s.getName().startsWith('ARCHIVED_'))
    .map(s => {
      const classId = s.getName().replace('ARCHIVED_', '');
      // Count archived students for this class
      let studentCount = 0;
      try {
        const rows = toRows(shOrCreate('Archived_Users', null));
        studentCount = rows.filter(r => normalizeClass(r.Class) === normalizeClass(classId)).length;
      } catch(e) {}
      return { classId, archivedName: s.getName(), studentCount };
    });
  return { success: true, classes: sheets };
}

function createClass(b) {
  const className = (b.className||'').trim();
  if (!className) return {success:false, message:'Class name is required.'};
  const ss = SS();
  const existing = ss.getSheetByName(className);
  if (existing) return {success:false, message:'A class named "' + className + '" already exists.'};
  createClassSheet(className);
  invalidateSummary(); // new class appears immediately
  return {success:true, className};
}

function createClassSheet(className) {
  className = className || 'New Class';
  const ss = SS();
  const existing = ss.getSheetByName(className);
  if (existing) { Logger.log('Sheet already exists: ' + className); return; }
  const s = ss.insertSheet(className);
  s.getRange(1, 1, 1, 7).setValues([[
    'Day', 'AccumulatedHours', 'Skills', 'Contents', 'DATE', 'RemainingDays', 'AdjustedContent'
  ]]);
  s.getRange(1, 1, 1, 7).setBackground('#1a1916').setFontColor('#ffffff').setFontWeight('bold');
  s.setFrozenRows(1);
  Logger.log('✅ Class sheet created: ' + className);
}
// ── Welcome email with Student ID (sent after registration)
function sendWelcomeEmail(name, email, classId, studentId) {
  const body = ''
    + '<p style="font-size:15px;color:#1a1916;margin:0 0 16px">Dear ' + highlight(name) + ',</p>'
    + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
    + 'Your EduPortal account has been created successfully. Here are your details:</p>'
    + infoBox([
        ['Full Name',       highlight(name)],
        ['Class',           highlight(classId)],
        ['Student ID',      '<span style="font-size:16px;font-weight:800;color:#4285F4;letter-spacing:1px">' + studentId + '</span>'],
        ['Email',           email],
      ])
    + '<div style="background:#e8f0fe;border-radius:8px;padding:14px 16px;margin:16px 0;">'
    + '<p style="margin:0;font-size:13px;color:#1a73e8;font-weight:700">What to do next:</p>'
    + '<ul style="margin:8px 0 0 16px;font-size:13px;color:#3d3d3a;line-height:1.9">'
    + '<li>Log in to EduPortal using your email and password</li>'
    + '<li>Use your Student ID <strong>' + studentId + '</strong> to register on Language Hub</li>'
    + '<li>Keep this ID safe — you will need it for cross-platform access</li>'
    + '</ul></div>'
    + divider()
    + '<p style="font-size:15px;color:#1a1916;margin:16px 0">Xin chao ' + highlight(name) + ',</p>'
    + '<p style="font-size:14px;color:#3d3d3a;line-height:1.6;margin:0 0 16px">'
    + 'Tai khoan EduPortal cua ban da duoc tao thanh cong. Thong tin tai khoan:</p>'
    + infoBox([
        ['Ho ten',      highlight(name)],
        ['Lop',         highlight(classId)],
        ['Ma sinh vien','<span style="font-size:16px;font-weight:800;color:#4285F4;letter-spacing:1px">' + studentId + '</span>'],
      ])
    + '<p style="font-size:13px;color:#3d3d3a;line-height:1.7;margin:8px 0 0">'
    + 'Dung ma sinh vien <strong>' + studentId + '</strong> de dang ky tren Language Hub.</p>';

  GmailApp.sendEmail(
    email,
    '[EduPortal] Chao mung — Ma sinh vien cua ban: ' + studentId,
    '',
    { htmlBody: emailWrapper('Welcome to EduPortal', 'Chao mung den EduPortal', body, classId) }
  );
  Logger.log('Welcome email sent to ' + email + ' | ID: ' + studentId);
}

// ── Test functions
function testHWReminderEmail() {
  const testEmail = REPORT_EMAIL;
  sendHWReminderEmails(
    {type:'S', content:'Speaking Part 2 - Test content\n1. a good-looking person\n2. an impressive lesson',
     deadline:fmtDate(new Date(Date.now()+86400000)), sessionDate:fmtDate(new Date())},
    [{Email:testEmail, FullName:'Duong Thanh Tu (TEST)'}], 1
  );
  Logger.log('✅ Test HW Reminder sent to '+testEmail);
}
function testTuitionReminderDigest() {
  sendTuitionReminderDigestToTeacher('IELTS 41', fmtDate(new Date()), [
    {name:'Nguyen Van A (TEST)', email:'student1@test.com', unpaidMonths:[8],    triggerLabel:4},
    {name:'Tran Thi B (TEST)',   email:'student2@test.com', unpaidMonths:[7,8],  triggerLabel:4},
    {name:'Le Van C (TEST)',     email:'student3@test.com', unpaidMonths:[6,7,8],triggerLabel:4},
  ]);
  Logger.log('Test digest sent to ' + REPORT_EMAIL);
}
function testTuitionReminderEmail() {
  // 1 month unpaid — neutral reminder (S4)
  sendTuitionReminderEmail('Duong Thanh Tu (TEST)', REPORT_EMAIL, 'IELTS 41', [8], 28, 4);
  Utilities.sleep(1000);
  // 2 months unpaid — urgent (S8)
  sendTuitionReminderEmail('Duong Thanh Tu (TEST)', REPORT_EMAIL, 'IELTS 41', [7, 8], 32, 8);
  Utilities.sleep(1000);
  // 3 months unpaid — suspension warning (S4)
  sendTuitionReminderEmail('Duong Thanh Tu (TEST)', REPORT_EMAIL, 'IELTS 41', [6, 7, 8], 36, 4);
  Logger.log('✅ Test Tuition Reminders (1/2/3 months) sent to '+REPORT_EMAIL);
}
function testTuitionPaidEmail() {
  sendTuitionPaidEmail('Duong Thanh Tu (TEST)', REPORT_EMAIL, 'IELTS 41', 4, fmtDate(new Date()), 'bank');
  Logger.log('✅ Test Tuition Paid (student) sent to '+REPORT_EMAIL);
}
function testTuitionPaidTeacherEmail() {
  sendTuitionPaidConfirmToTeacher('Nguyen Van A (TEST)', 'student@test.com', 'IELTS 41', 4, fmtDate(new Date()), 'cash');
  Logger.log('✅ Test Tuition Paid (teacher confirm) sent to '+REPORT_EMAIL);
}
function testAllEmails() {
  testHWReminderEmail();     Utilities.sleep(1500);
  testTuitionReminderEmail();Utilities.sleep(1500);
  testTuitionPaidEmail();    Utilities.sleep(1500);
  testTuitionPaidTeacherEmail();
  Logger.log('✅ All test emails sent!');
}
function getAttendanceMatrix(b) {
  var classId = b.classId;
  if (!classId) return { success: false, message: 'classId required' };
  var cKey = 'cls_' + classId + '_attmatrix';
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
  cachePutIndexed('cls_' + classId, cKey, resultAM);
  return resultAM;
}
