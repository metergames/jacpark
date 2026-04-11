# Database Setup Guide

## Creating the Profiles Table in Supabase

To enable the leaderboard feature to read from your database, you need to create a `profiles` table in Supabase.

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Click "New Query"
4. Copy and paste the SQL below:

```sql
-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    points INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create RLS policy: Users can read all profiles (for leaderboard)
CREATE POLICY "Profiles are viewable by everyone"
    ON public.profiles FOR SELECT
    USING (true);

-- Create RLS policy: Users can update their own profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Create RLS policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Create a function to automatically create a profile when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, avatar_url, points)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'avatar_url',
        0
    );
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

5. Click "Run" and the table will be created

### Option 2: Set up via the Supabase TypeScript Client

If you prefer to set up programmatically, you can run this query via the SQL Editor once.

### What This SQL Does:

- **Creates a `profiles` table** with fields for:
  - `id`: User ID (linked to auth.users)
  - `full_name`: User's display name
  - `avatar_url`: User's avatar
  - `points`: Points earned from parking reports (starts at 0)
  - `created_at`, `updated_at`: Timestamps

- **Enables Row Level Security (RLS)** so:
  - Everyone can read all profiles (for the leaderboard)
  - Users can only update their own profile
  - Users can only insert their own profile

- **Creates an automatic trigger** that:
  - Creates a profile automatically when a new user signs up
  - Populates `full_name` and `avatar_url` from Google auth metadata

### Updating User Profiles

After the table is set up, you can update user points in your reports API:

```typescript
// Example: Update user points after they submit a report
const { error } = await supabase
    .from("profiles")
    .update({ points: user_points + 1 })
    .eq("id", user_id);
```

### Manual Profile Updates

You can also manually update a user's profile:

```typescript
const { error } = await supabase
    .from("profiles")
    .update({
        full_name: "New Name",
        avatar_url: "https://...",
        points: 100
    })
    .eq("id", user_id);
```

### Leaderboard Queries

Once set up, the leaderboard will automatically:
1. Fetch the top 10 users by points
2. Calculate each user's rank
3. Display their profile info from the database

No further configuration needed!
