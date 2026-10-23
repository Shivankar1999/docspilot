'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorMessage, Field } from '@/components/form';
import { apiRequest } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await apiRequest('/api/auth/signup', {
        method: 'POST',
        body: {
          companyName: form.get('companyName'),
          email: form.get('email'),
          password: form.get('password'),
        },
      });
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Create your workspace</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <Field label="Company name" name="companyName" autoComplete="organization" required />
        <Field label="Work email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password (8+ characters)"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </>
  );
}
