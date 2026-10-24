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
      <p class="text-xs opacity-90 leading-relaxed">${message}</p>
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

  const [universities, regions, trips, bookings, profiles, buses, drivers] = await Promise.all([
    client.from('universities').select('*').order('name', { ascending: true }),
    client.from('regions').select('*').order('name', { ascending: true }),
    client.from('trips').select('*').order('trip_date', { ascending: true }),
    client.from('bookings').select('*').order('created_at', { ascending: false }),
    client.from('profiles').select('*').order('full_name', { ascending: true }),
    client.from('buses').select('*').order('plate_number', { ascending: true }),
    client.from('drivers').select('*').order('name', { ascending: true })
  ]);

  const queryResults = [universities, regions, trips, bookings, profiles, buses, drivers];
  const failedQuery = queryResults.find((result) => result.error);
  if (failedQuery) {
    console.error('Supabase data load failed:', failedQuery.error);
    showToast('فشل تحميل بيانات التشغيل من Supabase. تحقق من الجداول وسياسات RLS.', 'error');
    return;
  }

  MOVEFLOW.state.universities = universities.data;
  MOVEFLOW.state.regions = regions.data;
  MOVEFLOW.state.trips = trips.data;
  MOVEFLOW.state.bookings = bookings.data;
  MOVEFLOW.state.profiles = profiles.data;
  MOVEFLOW.state.buses = buses.data;
  MOVEFLOW.state.drivers = drivers.data;

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

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    showToast('أدخل بريدًا إلكترونيًا صالحًا لحساب Supabase.', 'error');
    return;
  }

  if (!MOVEFLOW.state.client) {
    showToast('Supabase غير جاهز بعد. حاول مرة أخرى.', 'error');
    return;
  }

  try {
    const { data: authData, error: authError } = await MOVEFLOW.state.client.auth.signInWithPassword({
      email: identifier,
      password
    });
    if (authError) throw authError;
    if (!authData.user) throw new Error('Authentication returned no user');

    const { data: profile, error: profileError } = await MOVEFLOW.state.client
      .from('profiles')
      .select('id, company_id, role, full_name, phone')
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
  const container = document.getElementById('student-trips-container');
  if (!container) return;

  const trips = MOVEFLOW.state.trips || [];
  const bookedTripIds = (MOVEFLOW.state.bookings || [])
    .filter((booking) => booking.student_id === MOVEFLOW.state.currentUser?.id && booking.status === 'confirmed')
    .map((booking) => booking.trip_id);

  if (!trips.length) {
    container.innerHTML = '<div class="p-6 text-slate-500">لا توجد رحلات متاحة حاليًا.</div>';
    return;
  }

  container.innerHTML = trips.map((trip) => {
    const isBooked = bookedTripIds.includes(trip.id);
    const isFull = Number(trip.available_seats ?? trip.capacity ?? 0) <= 0;
    const isClosed = trip.status === 'closed' || trip.is_booking_open === false;

    let badgeClass = 'bg-brand-50 text-brand-600 border-brand-100';
    let badgeText = 'متاح للحجز';
    let icon = 'fa-ticket';

    if (isBooked) {
      badgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
      badgeText = 'محجوزة';
      icon = 'fa-check';
    } else if (isFull) {
      badgeClass = 'bg-rose-100 text-rose-700 border-rose-200';
      badgeText = 'مكتملة السعة';
      icon = 'fa-ban';
    } else if (isClosed) {
      badgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
      badgeText = 'الحجز مغلق';
      icon = 'fa-lock';
    }

    const availableSeats = Number(trip.available_seats ?? trip.capacity ?? 0);
    const progress = Math.max(0, Math.min(100, ((Number(trip.capacity || 0) - availableSeats) / (Number(trip.capacity || 1) || 1)) * 100));
    const buttonHtml = isBooked
      ? `<button type="button" onclick="cancelBooking('${trip.id}')" class="w-full mt-4 py-3 rounded-xl font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors">إلغاء الحجز</button>`
      : `<button type="button" onclick="handleBooking('${trip.id}')" class="w-full mt-4 py-3 rounded-xl font-bold text-white transition-all ${isFull || isClosed ? 'bg-slate-300 cursor-not-allowed' : 'bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 shadow-md shadow-brand-500/20 hover:-translate-y-0.5'}" ${isFull || isClosed ? 'disabled' : ''}>${isFull ? 'لا توجد مقاعد' : isClosed ? 'الحجز غير متاح' : 'تأكيد الحجز'}</button>`;

    return `
      <article class="trip-card bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col">
        <div class="p-6 pb-4 border-b border-dashed border-slate-200 flex justify-between items-start">
          <div>
            <span class="text-xs font-bold text-slate-400 block mb-1">رقم الرحلة: ${trip.id || trip.trip_code || '—'}</span>
            <h3 class="text-xl font-black text-slate-800">${trip.route_name || 'رحلة عامة'}</h3>
          </div>
          <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${badgeClass}"><i class="fa-solid ${icon}"></i> ${badgeText}</span>
        </div>
        <div class="p-6 pt-5 flex-1 flex flex-col">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-12 h-12 rounded-2xl ${trip.direction === 'عودة' ? 'bg-accent-50 text-accent-600' : 'bg-brand-50 text-brand-600'} flex items-center justify-center text-xl shadow-inner">
              <i class="fa-solid ${trip.direction === 'عودة' ? 'fa-house-chimney' : 'fa-bus'}"></i>
            </div>
            <div>
              <p class="text-sm font-bold text-slate-500 mb-0.5">اتجاه الرحلة / الوقت</p>
              <p class="text-lg font-black text-slate-800 flex items-center gap-2">${trip.direction || 'ذهاب'} <i class="fa-solid fa-circle text-[6px] text-slate-300"></i> <span class="text-brand-600">${trip.departure_time || trip.time || '—'}</span></p>
            </div>
          </div>
          <div class="mt-auto">
            <div class="flex justify-between text-sm mb-2">
              <span class="font-bold text-slate-500">حالة المقاعد</span>
              <span class="font-black ${isFull ? 'text-rose-500' : 'text-slate-700'}">${Number(trip.booked ?? trip.occupied ?? 0)} <span class="text-slate-400 font-medium text-xs">من ${Number(trip.capacity || 0)}</span></span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2 mb-2 overflow-hidden">
              <div class="${progress > 80 ? 'bg-rose-500' : progress > 50 ? 'bg-amber-500' : 'bg-emerald-500'} h-full rounded-full transition-all duration-700" style="width: ${progress}%"></div>
            </div>
            ${buttonHtml}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function handleBooking(tripId) {
  const trip = (MOVEFLOW.state.trips || []).find((item) => item.id === tripId);
  if (!trip) {
    showToast('الرحلة غير موجودة.', 'error');
    return;
  }

  if (!MOVEFLOW.state.currentUser) {
    showToast('يجب تسجيل الدخول أولاً.', 'error');
    return;
  }

  const existing = (MOVEFLOW.state.bookings || []).find((b) => b.trip_id === tripId && b.student_id === MOVEFLOW.state.currentUser.id);
  if (existing) {
    showToast('لقد تم حجز هذه الرحلة من قبل.', 'error');
    return;
  }

  try {
    const { error } = await MOVEFLOW.state.client.rpc('create_booking', { p_trip_id: tripId });
    if (error) throw error;

    await loadReferenceData();
    showToast('تم تأكيد الحجز بنجاح.', 'success');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'تعذر تنفيذ الحجز. تحقق من قاعدة البيانات والسياسات.', 'error');
  }
}

async function cancelBooking(tripId) {
  if (!MOVEFLOW.state.currentUser) return;

  try {
    const { error } = await MOVEFLOW.state.client.rpc('cancel_booking', { p_trip_id: tripId });
    if (error) throw error;

    await loadReferenceData();
    showToast('تم إلغاء الحجز بنجاح.', 'info');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'تعذر إلغاء الحجز.', 'error');
  }
}

function renderAdminDashboard() {
  if (!document.getElementById('admin-trips-table-body')) return;

  const bookingsCount = (MOVEFLOW.state.bookings || []).length;
  const trips = MOVEFLOW.state.trips || [];
  const totalSeats = trips.reduce((sum, trip) => sum + Number(trip.capacity || 0), 0);
  const activeTrips = trips.filter((trip) => trip.status !== 'closed').length;

  document.getElementById('stat-bookings').textContent = bookingsCount;
  document.getElementById('stat-buses').textContent = (MOVEFLOW.state.buses || []).length;
  document.getElementById('stat-trips').textContent = activeTrips;
  document.getElementById('stat-capacity').textContent = totalSeats;

  const tableBody = document.getElementById('admin-trips-table-body');
  tableBody.innerHTML = trips.map((trip) => {
    const booked = Number(trip.booked || 0);
    const capacity = Number(trip.capacity || 0);
    const pct = capacity ? Math.min((booked / capacity) * 100, 100) : 0;
    let statusClass = 'neutral';
    if (trip.status === 'confirmed' || trip.status === 'مجدولة') statusClass = 'success';
    if (trip.status === 'closed' || trip.status === 'مكتملة') statusClass = 'danger';
    if (trip.status === 'pending') statusClass = 'warning';

    return `
      <tr class="border-b border-slate-200 hover:bg-slate-50">
        <td class="px-4 py-3 font-bold text-slate-800">${trip.id || trip.trip_code || '—'}</td>
        <td class="px-4 py-3">${trip.route_name || 'رحلة عامة'}</td>
        <td class="px-4 py-3">${trip.direction || 'ذهاب'}</td>
        <td class="px-4 py-3">${trip.departure_time || trip.time || '—'}</td>
        <td class="px-4 py-3">${booked}/${capacity}</td>
        <td class="px-4 py-3"><div class="w-28 bg-slate-100 rounded-full h-2"><div class="bg-brand-500 h-full rounded-full" style="width:${pct}%"></div></div></td>
        <td class="px-4 py-3"><span class="status-pill ${statusClass}">${trip.status || 'مجدولة'}</span></td>
      </tr>
    `;
  }).join('');
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
      .select('id, company_id, role, full_name, phone')
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

  initApp();
});
