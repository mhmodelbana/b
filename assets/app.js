const MOVEFLOW = {
  config: window.MOVEFLOW_CONFIG || {},
  state: {
    currentUser: null,
    currentRole: null,
    trips: [],
    bookings: [],
    universities: [],
    regions: [],
    buses: [],
    drivers: [],
    profiles: [],
    departureSlots: [],
    dailySignups: [],
    signupCutoff: '22:00',
    companyId: 'default-company',
    client: null
  },
  formatters: {
    date(value) {
      if (!value) return '—';
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('ar-EG').format(d);
    }
  }
};

const { supabaseUrl, supabaseAnonKey } = MOVEFLOW.config;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function cairoDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextCairoDate() {
  const nextDate = new Date(`${cairoDateString()}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

function formatArabicDate(dateString) {
  const date = new Date(`${dateString}T12:00:00+02:00`);
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function formatArabicTime(timeString) {
  if (!timeString) return '—';
  const normalized = String(timeString).slice(0, 5);
  const date = new Date(`1970-01-01T${normalized}:00Z`);
  return new Intl.DateTimeFormat('ar-EG', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC'
  }).format(date);
}

function normalizePhone(phone) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  return String(phone || '')
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/\D/g, '');
}

function phoneLoginEmail(phone) {
  const digits = normalizePhone(phone);
  return `student-${digits}@moveflow.invalid`;
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const config = {
    success: { badge: 'نجاح!', icon: 'fa-check-circle', fg: 'text-emerald-500', bg: 'bg-white', border: 'border-emerald-500' },
    error: { badge: 'خطأ!', icon: 'fa-circle-exclamation', fg: 'text-red-500', bg: 'bg-white', border: 'border-red-500' },
    info: { badge: 'تنبيه', icon: 'fa-info-circle', fg: 'text-brand-500', bg: 'bg-slate-900', border: 'border-slate-700' }
  };
  const cfg = config[type] || config.info;

  toast.className = `toast-enter flex items-start gap-3 p-4 rounded-xl shadow-xl border-l-4 ${cfg.bg} ${cfg.border} text-slate-800`;
  if (type === 'info') toast.classList.add('text-white');

  toast.innerHTML = `
    <i class="fa-solid ${cfg.icon} ${cfg.fg} text-xl mt-0.5"></i>
    <div class="flex-1">
      <h4 class="font-bold text-sm mb-1">${cfg.badge}</h4>
      <p class="text-xs opacity-90 leading-relaxed">${escapeHtml(message)}</p>
    </div>
    <button type="button" onclick="this.parentElement.remove()" class="text-slate-400 hover:text-slate-600"><i class="fa-solid fa-xmark"></i></button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.classList.replace('toast-enter', 'toast-exit');
      setTimeout(() => toast.remove(), 400);
    }
  }, 3500);
}

function setCurrentUser(user) {
  MOVEFLOW.state.currentUser = user;
  MOVEFLOW.state.currentRole = user?.role || null;
  const loginView = document.getElementById('login-view');
  const studentView = document.getElementById('student-view');
  const adminView = document.getElementById('admin-view');

  if (!user) {
    if (!loginView) {
      window.location.replace('./index.html');
      return;
    }
    loginView.classList.remove('hidden-view');
    studentView?.classList.add('hidden-view');
    adminView?.classList.add('hidden-view');
    return;
  }

  if (user.role === 'admin' && !adminView) {
    window.location.replace('./admin.html');
    return;
  }

  loginView?.classList.add('hidden-view');
  if (user.role === 'student') {
    studentView.classList.remove('hidden-view');
    adminView?.classList.add('hidden-view');
    renderStudentTrips();
  } else {
    adminView.classList.remove('hidden-view');
    studentView?.classList.add('hidden-view');
    renderAdminDashboard();
  }
}

async function logout() {
  if (MOVEFLOW.state.client) {
    const { error } = await MOVEFLOW.state.client.auth.signOut();
    if (error) {
      console.error(error);
      showToast('تعذر إنهاء جلسة Supabase.', 'error');
      return;
    }
  }
  MOVEFLOW.state.currentUser = null;
  MOVEFLOW.state.currentRole = null;
  setCurrentUser(null);
  showToast('تم تسجيل الخروج بنجاح.', 'info');
}

async function initSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    showToast('بيانات Supabase غير متوفرة. تأكد من تهيئة URL وanon key قبل التشغيل.', 'error');
    return false;
  }

  if (!window.supabase) {
    showToast('مكتبة Supabase غير محمّلة. تحقق من وجود الرابط قبل تشغيل التطبيق.', 'error');
    return false;
  }

  MOVEFLOW.state.client = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    }
  });
  return true;
}

async function loadReferenceData() {
  const client = MOVEFLOW.state.client;
  if (!client) return;

  const isAdmin = MOVEFLOW.state.currentRole === 'admin';
  const serviceDate = nextCairoDate();

  const profileQuery = client.from('profiles').select(
    'id, company_id, role, full_name, phone, parent_phone, home_region, university_id'
  ).order('full_name', { ascending: true });
  if (!isAdmin) profileQuery.eq('id', MOVEFLOW.state.currentUser?.id);

  const [universities, slots, signups, profiles, settings] = await Promise.all([
    client.from('universities').select('id, name').order('name', { ascending: true }),
    client.from('departure_slots').select('id, departure_time, label, is_active').order('departure_time', { ascending: true }),
    client.from('daily_signups').select('id, student_id, service_date, departure_slot_id, status')
      .eq('service_date', serviceDate).eq('status', 'registered'),
    profileQuery,
    isAdmin
      ? client.from('daily_signup_settings').select('cutoff_time').maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);

  const queryResults = [universities, slots, signups, profiles, settings];
  const failedQuery = queryResults.find((result) => result.error);
  if (failedQuery) {
    console.error('Supabase data load failed:', failedQuery.error);
    showToast(`فشل تحميل البيانات: ${failedQuery.error.message}`, 'error');
    return;
  }

  MOVEFLOW.state.universities = universities.data;
  MOVEFLOW.state.departureSlots = slots.data;
  MOVEFLOW.state.dailySignups = signups.data;
  MOVEFLOW.state.profiles = profiles.data;
  MOVEFLOW.state.signupCutoff = settings.data?.cutoff_time || '22:00';

  renderStudentTrips();
  renderAdminDashboard();
}

async function loginWithSupabase(role) {
  const identifier = document.getElementById('login-identifier')?.value?.trim();
  const password = document.getElementById('login-password')?.value?.trim();

  if (!identifier || !password) {
    showToast('أدخل البريد الإلكتروني وكلمة المرور.', 'error');
    return;
  }

  if (!MOVEFLOW.state.client) {
    showToast('Supabase غير جاهز بعد. حاول مرة أخرى.', 'error');
    return;
  }

  try {
    const loginEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)
      ? identifier
      : phoneLoginEmail(identifier);
    if (loginEmail === 'student-@moveflow.invalid') {
      showToast('أدخل البريد الإلكتروني أو رقم الهاتف المسجل لدى الإدارة.', 'error');
      return;
    }
    const { data: authData, error: authError } = await MOVEFLOW.state.client.auth.signInWithPassword({
      email: loginEmail,
      password
    });
    if (authError) throw authError;
    if (!authData.user) throw new Error('Authentication returned no user');

    const { data: profile, error: profileError } = await MOVEFLOW.state.client
      .from('profiles')
      .select('id, company_id, role, full_name, phone, parent_phone, home_region, university_id')
      .eq('id', authData.user.id)
      .single();
    if (profileError) throw profileError;
    if (profile.role !== role) {
      await MOVEFLOW.state.client.auth.signOut();
      showToast('هذا الحساب غير مصرح له باستخدام هذه الصفحة.', 'error');
      return;
    }

    setCurrentUser({ ...profile, auth_user: authData.user });

    await loadReferenceData();
    showToast(`مرحباً، ${profile.full_name || 'المستخدم'}!`, 'success');
  } catch (error) {
    console.error('login failed', error);
    if (error.message === 'Invalid login credentials') {
      showToast('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'error');
    } else {
      showToast(error.message || 'فشل تسجيل الدخول. تحقق من إعدادات Supabase.', 'error');
    }
  }
}

function renderStudentTrips() {
  const form = document.getElementById('student-signup-form');
  if (!form) return;

  const profile = MOVEFLOW.state.currentUser;
  const university = MOVEFLOW.state.universities.find((item) => item.id === profile?.university_id);
  const summary = document.getElementById('student-profile-summary');
  summary.innerHTML = profile
    ? `<strong>${escapeHtml(profile.full_name)}</strong> · ${escapeHtml(profile.home_region || 'البلد غير محدد')} · ${escapeHtml(university?.name || 'الجامعة غير محددة')}`
    : 'بيانات حساب الطالب غير متاحة.';

  const serviceDate = nextCairoDate();
  const title = document.getElementById('student-tomorrow-title');
  if (title) title.textContent = `اختار ميعاد نزولك بكرة · ${formatArabicDate(serviceDate)}`;

  const slots = MOVEFLOW.state.departureSlots.filter((slot) => slot.is_active);
  const select = document.getElementById('departure-slot-select');
  const currentSignup = MOVEFLOW.state.dailySignups.find((signup) =>
    signup.student_id === profile?.id && signup.status === 'registered'
  );
  select.innerHTML = slots.length
    ? `<option value="">اختار ميعاد التحرك</option>${slots.map((slot) =>
      `<option value="${escapeHtml(slot.id)}" ${slot.id === currentSignup?.departure_slot_id ? 'selected' : ''}>${escapeHtml(slot.label || formatArabicTime(slot.departure_time))}</option>`
    ).join('')}`
    : '<option value="">لا توجد مواعيد متاحة حاليًا</option>';
  select.disabled = slots.length === 0;

  const status = document.getElementById('student-signup-status');
  const currentSlot = slots.find((slot) => slot.id === currentSignup?.departure_slot_id);
  status.innerHTML = currentSignup
    ? `<div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 font-bold">تم تسجيلك لبكرة في ميعاد ${escapeHtml(currentSlot?.label || formatArabicTime(currentSlot?.departure_time))}. تقدر تغيّر الميعاد قبل إغلاق التسجيل.<button id="cancel-tomorrow-signup" type="button" class="mr-3 text-rose-700 underline">إلغاء التسجيل</button></div>`
    : '<div class="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-brand-800 font-semibold">لسه ما سجلتش ميعاد بكرة.</div>';

  const cutoff = document.getElementById('student-signup-cutoff');
  if (cutoff) cutoff.textContent = `التسجيل والتعديل متاحان حتى ${formatArabicTime(MOVEFLOW.state.signupCutoff)} بتوقيت القاهرة.`;
}

async function submitTomorrowSignup(event) {
  event.preventDefault();
  const slotId = document.getElementById('departure-slot-select')?.value;
  if (!slotId) {
    showToast('اختار ميعاد التحرك أولًا.', 'error');
    return;
  }

  const { error } = await MOVEFLOW.state.client.rpc('register_for_tomorrow', {
    p_departure_slot_id: slotId
  });
  if (error) {
    console.error('Daily signup failed:', error);
    showToast(error.message || 'تعذر تسجيل ميعادك.', 'error');
    return;
  }

  await loadReferenceData();
  showToast('اتسجل ميعادك لبكرة بنجاح.', 'success');
}

async function cancelTomorrowSignup() {
  const { error } = await MOVEFLOW.state.client.rpc('cancel_tomorrow_signup');
  if (error) {
    console.error('Daily signup cancellation failed:', error);
    showToast(error.message || 'تعذر إلغاء التسجيل.', 'error');
    return;
  }
  await loadReferenceData();
  showToast('تم إلغاء تسجيل مشوار بكرة.', 'info');
}

function renderAdminDashboard() {
  if (!document.getElementById('tomorrow-signups-body')) return;

  const activeSignups = MOVEFLOW.state.dailySignups.filter((signup) => signup.status === 'registered');
  const activeSlots = MOVEFLOW.state.departureSlots.filter((slot) => slot.is_active);
  document.getElementById('stat-tomorrow-signups').textContent = activeSignups.length;
  document.getElementById('stat-active-slots').textContent = activeSlots.length;
  document.getElementById('stat-students').textContent = MOVEFLOW.state.profiles.filter((profile) => profile.role === 'student').length;

  const serviceDate = nextCairoDate();
  document.getElementById('admin-service-date').textContent = `تسجيلات ${formatArabicDate(serviceDate)} · الإغلاق ${formatArabicTime(MOVEFLOW.state.signupCutoff)} بتوقيت القاهرة`;
  document.getElementById('signup-cutoff-label').textContent = formatArabicTime(MOVEFLOW.state.signupCutoff);

  const summary = document.getElementById('signup-summary');
  summary.innerHTML = activeSlots.map((slot) => {
    const signups = activeSignups.filter((signup) => signup.departure_slot_id === slot.id);
    const groupCounts = new Map();
    signups.forEach((signup) => {
      const profile = MOVEFLOW.state.profiles.find((item) => item.id === signup.student_id);
      const university = MOVEFLOW.state.universities.find((item) => item.id === profile?.university_id);
      const name = university?.name || 'جامعة غير محددة';
      const region = profile?.home_region || 'بلد غير محدد';
      const key = `${name}\u0000${region}`;
      groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
    });
    const breakdown = [...groupCounts.entries()]
      .map(([key, count]) => {
        const [university, region] = key.split('\u0000');
        return `${escapeHtml(university)} · ${escapeHtml(region)}: ${count}`;
      })
      .join(' · ') || 'لا توجد تسجيلات';
    return `<article class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div class="flex items-center justify-between gap-3"><h3 class="font-black text-slate-900">${escapeHtml(slot.label || formatArabicTime(slot.departure_time))}</h3><span class="rounded-full bg-brand-100 px-3 py-1 text-sm font-black text-brand-700">${signups.length} طالب</span></div><p class="text-sm text-slate-600 mt-2">${breakdown}</p></article>`;
  }).join('') || '<p class="text-slate-500">أضف مواعيد التحرك لبدء التسجيل.</p>';

  const rows = activeSignups.map((signup) => {
    const profile = MOVEFLOW.state.profiles.find((item) => item.id === signup.student_id);
    const university = MOVEFLOW.state.universities.find((item) => item.id === profile?.university_id);
    const slot = MOVEFLOW.state.departureSlots.find((item) => item.id === signup.departure_slot_id);
    return {
      slotTime: slot?.departure_time || '99:99',
      html: `<tr class="border-b border-slate-100 hover:bg-slate-50"><td class="px-4 py-3 font-bold">${escapeHtml(slot?.label || formatArabicTime(slot?.departure_time))}</td><td class="px-4 py-3">${escapeHtml(profile?.full_name || '—')}</td><td class="px-4 py-3" dir="ltr">${escapeHtml(profile?.phone || '—')}</td><td class="px-4 py-3" dir="ltr">${escapeHtml(profile?.parent_phone || '—')}</td><td class="px-4 py-3">${escapeHtml(profile?.home_region || '—')}</td><td class="px-4 py-3">${escapeHtml(university?.name || '—')}</td></tr>`
    };
  }).sort((a, b) => a.slotTime.localeCompare(b.slotTime));
  document.getElementById('tomorrow-signups-body').innerHTML = rows.length
    ? rows.map((row) => row.html).join('')
    : '<tr><td colspan="6" class="px-4 py-8 text-center text-slate-500">لا توجد تسجيلات لبكرة حتى الآن.</td></tr>';

  const universitySelect = document.getElementById('new-student-university');
  if (universitySelect) {
    universitySelect.innerHTML = '<option value="">اختار الجامعة</option>' + MOVEFLOW.state.universities
      .map((university) => `<option value="${escapeHtml(university.id)}">${escapeHtml(university.name)}</option>`)
      .join('');
  }

  const slotsList = document.getElementById('departure-slots-list');
  slotsList.innerHTML = MOVEFLOW.state.departureSlots.map((slot) => `
    <div class="inline-flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 ${slot.is_active ? 'bg-white' : 'bg-slate-100 text-slate-500'}">
      <span class="font-bold">${escapeHtml(slot.label || formatArabicTime(slot.departure_time))}</span>
      <button type="button" data-toggle-slot="${escapeHtml(slot.id)}" data-active="${slot.is_active}" class="text-xs font-bold ${slot.is_active ? 'text-rose-600' : 'text-emerald-700'}">${slot.is_active ? 'إيقاف' : 'تفعيل'}</button>
    </div>
  `).join('') || '<p class="text-slate-500">لا توجد مواعيد بعد.</p>';

  const cutoffInput = document.getElementById('signup-cutoff-time');
  if (cutoffInput) cutoffInput.value = String(MOVEFLOW.state.signupCutoff).slice(0, 5);
}

async function createStudent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const student = {
    fullName: document.getElementById('new-student-name').value.trim(),
    phone: document.getElementById('new-student-phone').value.trim(),
    parentPhone: document.getElementById('new-student-parent-phone').value.trim(),
    homeRegion: document.getElementById('new-student-region').value.trim(),
    universityId: document.getElementById('new-student-university').value
  };
  if (normalizePhone(student.phone).length < 7 || normalizePhone(student.parentPhone).length < 7) {
    showToast('راجع رقم الطالب ورقم ولي الأمر.', 'error');
    return;
  }

  const { data, error } = await MOVEFLOW.state.client.functions.invoke('create-student', { body: student });
  if (error) {
    console.error('Student provisioning failed:', error);
    showToast(error.message || 'تعذر إنشاء حساب الطالب. تحقق من إعداد Edge Function.', 'error');
    return;
  }

  const credentials = document.getElementById('created-student-credentials');
  credentials.classList.remove('hidden');
  credentials.innerHTML = `<strong class="block text-emerald-900 mb-2">تم إنشاء حساب ${escapeHtml(data.fullName)}.</strong><span>اسم الدخول: <b dir="ltr">${escapeHtml(data.phone)}</b></span><br><span>كلمة المرور المؤقتة: <b dir="ltr">${escapeHtml(data.temporaryPassword)}</b></span><p class="text-xs mt-2">احتفظ بكلمة المرور وسلّمها للطالب؛ لن تظهر مرة أخرى.</p>`;
  form.reset();
  await loadReferenceData();
  showToast('تم إنشاء حساب الطالب بنجاح.', 'success');
}

async function createDepartureSlot(event) {
  event.preventDefault();
  const input = document.getElementById('new-slot-time');
  const departureTime = input.value;
  if (!departureTime) return;

  const { error } = await MOVEFLOW.state.client.from('departure_slots').insert({
    company_id: MOVEFLOW.state.currentUser.company_id,
    departure_time: departureTime,
    label: formatArabicTime(departureTime),
    is_active: true
  });
  if (error) {
    console.error('Departure slot creation failed:', error);
    showToast(error.code === '23505' ? 'الموعد ده موجود بالفعل.' : error.message, 'error');
    return;
  }
  input.value = '';
  await loadReferenceData();
  showToast('تم إضافة ميعاد التحرك.', 'success');
}

async function toggleDepartureSlot(slotId, isActive) {
  const { error } = await MOVEFLOW.state.client
    .from('departure_slots')
    .update({ is_active: !isActive })
    .eq('id', slotId);
  if (error) {
    console.error('Departure slot update failed:', error);
    showToast(error.message || 'تعذر تحديث الموعد.', 'error');
    return;
  }
  await loadReferenceData();
  showToast(isActive ? 'تم إيقاف الموعد.' : 'تم تفعيل الموعد.', 'success');
}

async function saveSignupCutoff(event) {
  event.preventDefault();
  const cutoffTime = document.getElementById('signup-cutoff-time').value;
  if (!cutoffTime) {
    showToast('حدد وقت إغلاق التسجيل.', 'error');
    return;
  }

  const { error } = await MOVEFLOW.state.client.from('daily_signup_settings').upsert({
    company_id: MOVEFLOW.state.currentUser.company_id,
    cutoff_time: cutoffTime
  });
  if (error) {
    console.error('Signup cutoff update failed:', error);
    showToast(error.message || 'تعذر حفظ موعد إغلاق التسجيل.', 'error');
    return;
  }
  await loadReferenceData();
  showToast('تم حفظ موعد إغلاق التسجيل.', 'success');
}

function printTomorrowSignups() {
  window.print();
}
async function initApp() {
  const ok = await initSupabaseClient();
  if (!ok) {
    document.getElementById('login-view')?.classList.remove('hidden-view');
    return;
  }

  const { data: sessionData, error: sessionError } = await MOVEFLOW.state.client.auth.getSession();
  if (sessionError) {
    console.error(sessionError);
    showToast('تعذر استعادة جلسة الدخول.', 'error');
    return;
  }
  if (sessionData.session) {
    const { data: profile, error } = await MOVEFLOW.state.client
      .from('profiles')
      .select('id, company_id, role, full_name, phone, parent_phone, home_region, university_id')
      .eq('id', sessionData.session.user.id)
      .single();
    if (error) {
      console.error(error);
      await MOVEFLOW.state.client.auth.signOut();
      showToast('تعذر تحميل صلاحيات الحساب.', 'error');
      return;
    }

    const expectedRole = document.getElementById('admin-view') ? 'admin' : profile.role;
    if (profile.role !== expectedRole) {
      await MOVEFLOW.state.client.auth.signOut();
      if (expectedRole === 'admin') window.location.replace('./index.html');
      else showToast('هذا الحساب غير مصرح له باستخدام هذه الصفحة.', 'error');
      return;
    }

    setCurrentUser({ ...profile, auth_user: sessionData.session.user });
    if (profile.role === 'admin' && !document.getElementById('admin-view')) return;
    await loadReferenceData();
  } else if (document.getElementById('admin-view')) {
    window.location.replace('./index.html?role=admin');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const loginButtons = document.querySelectorAll('[data-role-login]');
  loginButtons.forEach((button) => {
    button.addEventListener('click', () => loginWithSupabase(button.getAttribute('data-role-login')));
  });

  document.querySelectorAll('#logout-button').forEach((button) => {
    button.addEventListener('click', logout);
  });

  document.getElementById('student-signup-form')?.addEventListener('submit', submitTomorrowSignup);
  document.getElementById('student-signup-status')?.addEventListener('click', (event) => {
    if (event.target.closest('#cancel-tomorrow-signup')) cancelTomorrowSignup();
  });
  document.getElementById('create-student-form')?.addEventListener('submit', createStudent);
  document.getElementById('create-slot-form')?.addEventListener('submit', createDepartureSlot);
  document.getElementById('signup-cutoff-form')?.addEventListener('submit', saveSignupCutoff);
  document.getElementById('departure-slots-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-toggle-slot]');
    if (button) {
      toggleDepartureSlot(button.dataset.toggleSlot, button.dataset.active === 'true');
    }
  });
  document.getElementById('print-signups')?.addEventListener('click', printTomorrowSignups);

  initApp();
});
