import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MessageCircle, Check, X, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const AuthPage = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Debounced username check
  useEffect(() => {
    if (!isSignUp || username.length < 3) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingUsername(true);
      const { data, error } = await supabase.rpc('check_username_available', {
        desired_username: username.toLowerCase(),
      });
      if (!error) setUsernameAvailable(data as boolean);
      setCheckingUsername(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [username, isSignUp]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (isSignUp) {
      if (!usernameAvailable) {
        toast({ title: 'Username not available', description: 'Please choose a different username.', variant: 'destructive' });
        setSubmitting(false);
        return;
      }
      const { error } = await signUp(email, password, username.toLowerCase(), displayName || username);
      if (error) {
        toast({ title: 'Sign up failed', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Welcome to Bubble!', description: 'Your account has been created.' });
        navigate('/chat');
      }
    } else {
      const { error } = await signIn(email, password);
      if (error) {
        toast({ title: 'Sign in failed', description: error.message, variant: 'destructive' });
      } else {
        navigate('/chat');
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bubble-gradient mb-4 bubble-glow">
            <MessageCircle className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground">Bubble</h1>
          <p className="text-muted-foreground mt-1">
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-xl border border-border">
          {isSignUp && (
            <>
              <div className="space-y-2">
                <Label htmlFor="username" className="text-foreground">Username</Label>
                <div className="relative">
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                    placeholder="unique_username"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground pr-10"
                    minLength={3}
                    maxLength={30}
                    required
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checkingUsername && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                    {!checkingUsername && usernameAvailable === true && <Check className="w-4 h-4 text-online" />}
                    {!checkingUsername && usernameAvailable === false && <X className="w-4 h-4 text-destructive" />}
                  </div>
                </div>
                {usernameAvailable === false && (
                  <p className="text-xs text-destructive">This username is already taken</p>
                )}
                {usernameAvailable === true && (
                  <p className="text-xs text-online">Username is available!</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName" className="text-foreground">Display Name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How others see you"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                  maxLength={50}
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="email" className="text-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-foreground">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              minLength={6}
              required
            />
          </div>

          <Button type="submit" className="w-full bubble-gradient text-primary-foreground font-semibold" disabled={submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {isSignUp ? 'Create Account' : 'Sign In'}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setUsernameAvailable(null); }}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuthPage;
