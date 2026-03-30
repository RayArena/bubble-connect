import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';

const ProfilePage = () => {
  const { profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
    setBio(profile?.bio || '');
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const response = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, bio }),
    });

    if (!response.ok) {
      const payload = await response.json();
      toast({ title: 'Error', description: payload.error || 'Failed to update profile', variant: 'destructive' });
    } else {
      toast({ title: 'Profile updated!' });
      await refreshProfile();
    }
    setSaving(false);
  };

  const handleDeleteProfile = async () => {
    if (!profile) return;

    const firstConfirmation = window.confirm(
      'Delete your account permanently? This will remove your profile and sign-in account. This cannot be undone.'
    );
    if (!firstConfirmation) return;

    const secondConfirmation = window.confirm(
      'Final confirmation: permanently delete your account, friendships, conversations, memberships, and messages?'
    );
    if (!secondConfirmation) return;

    setDeleting(true);
    try {
      const response = await fetch('/api/profile', { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Failed to delete account';
        toast({ title: 'Error', description: message, variant: 'destructive' });
        return;
      }

      toast({
        title: 'Account deleted',
        description: 'Your account and related data were permanently deleted.',
      });

      try {
        await signOut();
      } catch {
        // Account is already deleted server-side; continue redirect.
      }

      router.replace('/auth');
    } finally {
      setDeleting(false);
    }
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-6 space-y-4 text-center">
          <h1 className="text-xl font-display font-bold text-foreground">Profile unavailable</h1>
          <p className="text-sm text-muted-foreground">
            Your profile could not be loaded. It may have already been deleted.
          </p>
          <Button variant="ghost" onClick={signOut} className="w-full text-destructive hover:text-destructive hover:bg-destructive/10">
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-6 animate-fade-in">
        <button onClick={() => router.push('/chat')} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to chats
        </button>

        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-full bubble-gradient mx-auto mb-4 flex items-center justify-center text-4xl font-display font-bold text-primary-foreground">
            {displayName?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">{displayName}</h1>
          <p className="text-muted-foreground text-sm">@{profile.username}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="space-y-2">
            <Label className="text-foreground">Username</Label>
            <Input value={profile.username} disabled className="bg-muted border-border text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Username cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="bg-secondary border-border text-foreground"
              maxLength={50}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-foreground">Bio</Label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="bg-secondary border-border text-foreground resize-none"
              rows={3}
              maxLength={200}
              placeholder="Tell others about yourself..."
            />
          </div>

          <Button onClick={handleSave} className="w-full bubble-gradient text-primary-foreground" disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 mt-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Danger Zone</h2>
          <p className="text-xs text-muted-foreground">
            Deleting your account permanently removes your Clerk sign-in account and all related app data.
          </p>
          <Button
            variant="destructive"
            onClick={handleDeleteProfile}
            className="w-full"
            disabled={deleting}
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Account Permanently
          </Button>
        </div>

        <Button
          variant="ghost"
          onClick={signOut}
          className="w-full mt-4 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
};

export default ProfilePage;
