import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageCircle, Loader2, Mail } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type PendingSignUpData = {
  email: string;
  username: string;
  displayName: string;
};

const AuthVerifyPage = () => {
  const [code, setCode] = useState('');
  const [pendingData, setPendingData] = useState<PendingSignUpData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const { completeSignUpVerification, resendSignUpVerification } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('pendingSignUp');
      if (!raw) {
        router.replace('/auth');
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PendingSignUpData>;
      if (!parsed.email || !parsed.username || !parsed.displayName) {
        router.replace('/auth');
        return;
      }

      setPendingData({
        email: parsed.email,
        username: parsed.username,
        displayName: parsed.displayName,
      });
    } catch {
      router.replace('/auth');
    }
  }, [router]);

  const maskedEmail = useMemo(() => {
    if (!pendingData?.email) return '';

    const [local = '', domain = ''] = pendingData.email.split('@');
    if (!local || !domain) return pendingData.email;

    const visibleStart = local.slice(0, 2);
    const visibleEnd = local.length > 3 ? local.slice(-1) : '';
    const maskedLocal = `${visibleStart}${'*'.repeat(Math.max(local.length - visibleStart.length - visibleEnd.length, 1))}${visibleEnd}`;

    return `${maskedLocal}@${domain}`;
  }, [pendingData?.email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pendingData) {
      toast({
        title: 'Sign up session expired',
        description: 'Please start sign up again.',
        variant: 'destructive',
      });
      router.replace('/auth');
      return;
    }

    if (submitting) {
      return;
    }

    if (code.trim().length < 4) {
      toast({
        title: 'Invalid code',
        description: 'Please enter the verification code from your email.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);

    const { error } = await completeSignUpVerification(code, pendingData.username, pendingData.displayName);
    if (error) {
      toast({
        title: 'Verification failed',
        description: error.message,
        variant: 'destructive',
      });
      setSubmitting(false);
      return;
    }

    try {
      window.sessionStorage.removeItem('pendingSignUp');
    } catch {
      // Ignore storage failures.
    }

    toast({ title: 'Welcome to Bubble!', description: 'Your account has been verified and created.' });
    router.push('/chat');
  };

  const handleResend = async () => {
    if (resending) return;

    setResending(true);
    const { error } = await resendSignUpVerification();
    if (error) {
      toast({ title: 'Could not resend code', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Code sent', description: 'A new verification code was sent to your email.' });
    }
    setResending(false);
  };

  if (!pendingData) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bubble-gradient mb-4 bubble-glow">
            <MessageCircle className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Bubble</h1>
          <p className="text-muted-foreground mt-1">Verify your email to finish sign up</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-xl border border-border">
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground flex items-start gap-2">
            <Mail className="w-4 h-4 mt-0.5" />
            <p>
              Enter the verification code sent to <span className="font-medium text-foreground">{maskedEmail}</span>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="verificationCode" className="text-foreground">Verification Code</Label>
            <Input
              id="verificationCode"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
              placeholder="Enter your code"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              autoComplete="one-time-code"
              required
            />
          </div>

          <Button type="submit" className="w-full bubble-gradient text-primary-foreground font-semibold" disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Complete Sign Up
          </Button>

          <div className="text-center space-y-2">
            <button
              type="button"
              onClick={handleResend}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
              disabled={resending}
            >
              {resending ? 'Sending...' : 'Resend verification code'}
            </button>
            <div>
              <button
                type="button"
                onClick={() => router.push('/auth')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Back to sign up
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuthVerifyPage;
