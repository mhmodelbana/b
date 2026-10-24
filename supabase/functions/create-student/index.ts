import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(value: unknown) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)))
    .replace(/\D/g, "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Edge Function secrets");
    return jsonResponse({ error: "إعداد خدمة إنشاء الحسابات غير مكتمل." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "يجب تسجيل الدخول بحساب الإدارة." }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse({ error: "جلسة الدخول غير صالحة." }, 401);
  }

  const { data: adminProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("company_id, role")
    .eq("id", authData.user.id)
    .single();
  if (profileError || adminProfile?.role !== "admin") {
    return jsonResponse({ error: "إنشاء حسابات الطلاب متاح لمسؤول الشركة فقط." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "بيانات الطلب غير صالحة." }, 400);
  }

  const fullName = String(body.fullName ?? "").trim();
  const phone = normalizePhone(body.phone);
  const parentPhone = normalizePhone(body.parentPhone);
  const homeRegion = String(body.homeRegion ?? "").trim();
  const universityId = String(body.universityId ?? "").trim();
  if (!fullName || fullName.length > 120 || !homeRegion || homeRegion.length > 120 ||
      phone.length < 7 || phone.length > 20 || parentPhone.length < 7 ||
      parentPhone.length > 20 || !universityId) {
    return jsonResponse({ error: "راجع الاسم وأرقام الهاتف والبلد والجامعة." }, 400);
  }

  const { data: university, error: universityError } = await adminClient
    .from("universities")
    .select("id")
    .eq("id", universityId)
    .eq("company_id", adminProfile.company_id)
    .single();
  if (universityError || !university) {
    return jsonResponse({ error: "الجامعة المحددة غير موجودة ضمن شركة النقل." }, 400);
  }

  const { data: existingStudent, error: duplicateError } = await adminClient
    .from("profiles")
    .select("id")
    .eq("company_id", adminProfile.company_id)
    .eq("phone", phone)
    .maybeSingle();
  if (duplicateError) {
    console.error("Phone duplicate lookup failed:", duplicateError);
    return jsonResponse({ error: "تعذر التحقق من رقم الطالب." }, 500);
  }
  if (existingStudent) {
    return jsonResponse({ error: "رقم الطالب مسجل بالفعل." }, 409);
  }

  const temporaryPassword = `Mf!${crypto.randomUUID()}a9`;
  const email = `student-${phone}@moveflow.invalid`;
  const { data: createdAuth, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, account_type: "student" },
  });
  if (createError || !createdAuth.user) {
    console.error("Supabase Auth user creation failed:", createError);
    return jsonResponse({ error: createError?.message ?? "تعذر إنشاء حساب الدخول." }, 400);
  }

  const { error: insertProfileError } = await adminClient.from("profiles").insert({
    id: createdAuth.user.id,
    company_id: adminProfile.company_id,
    role: "student",
    full_name: fullName,
    phone,
    parent_phone: parentPhone,
    home_region: homeRegion,
    university_id: university.id,
  });
  if (insertProfileError) {
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdAuth.user.id);
    if (rollbackError) console.error("Failed to roll back student auth user:", rollbackError);
    console.error("Student profile creation failed:", insertProfileError);
    return jsonResponse({ error: "تعذر حفظ ملف الطالب؛ لم يكتمل إنشاء الحساب." }, 500);
  }

  return jsonResponse({ fullName, phone, temporaryPassword }, 201);
});
