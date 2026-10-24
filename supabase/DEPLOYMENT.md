# MoveFlow daily signups setup

1. Run `db/moveflow_schema.sql` in the Supabase SQL editor. It adds the student commute profile fields, the three universities, the default 7:00 AM departure, daily signup tables, RLS policies, and the functions that allow students to register or cancel for tomorrow.
2. Install the Supabase CLI and link the project:

   ```sh
   supabase link --project-ref ncohpghrygbvvzzrxelr
   ```

3. Set the server-only service role key as a Supabase Function secret. Do not put this value in `config.js`, HTML, or browser JavaScript:

   ```sh
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
   ```

   `SUPABASE_URL` and `SUPABASE_ANON_KEY` are supplied to the function by the Supabase runtime.

4. Deploy the protected student-account function:

   ```sh
   supabase functions deploy create-student
   ```

5. Create student accounts from the admin page. The function returns the student's phone login and a generated temporary password once; hand the credentials directly to the student.

Students log in using their phone number and the temporary password. The app maps that phone to an internal email identity for Supabase Auth. The student then chooses a departure time for tomorrow; the server enforces one active signup per student per service date and closes registration at the configured Cairo-time cutoff.

The default cutoff is 10:00 PM Africa/Cairo. Administrators can change it and manage departure times from the admin page. Student town/region and university are set only when the administrator creates the account.
