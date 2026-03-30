import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, ArrowLeft, Loader2, RotateCcw, Trash2 } from 'lucide-react';
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
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
    setBio(profile?.bio || '');
  }, [profile]);

  const isDeleted = Boolean(profile?.is_deleted);
  const recoverUntil = useMemo(() => {
    if (!profile?.deletion_recover_until) return null;
    const date = new Date(profile.deletion_recover_until);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }, [profile?.deletion_recover_until]);

  const handleSave = async () => {
    if (!profile || isDeleted) return;
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
    if (!profile || isDeleted) return;

    const confirmed = window.confirm(
      'Delete your profile? You can recover it within 30 days from this page.'
    );

    if (!confirmed) return;

    setDeleting(true);
    const response = await fetch('/api/profile', { method: 'DELETE' });
    const payload = await response.json();

    if (!response.ok) {
      toast({ title: 'Error', description: payload.error || 'Failed to schedule profile deletion', variant: 'destructive' });
      setDeleting(false);
      return;
    }

    toast({
      title: 'Profile scheduled for deletion',
      description: payload.recover_until
        ? `You can recover your profile until ${new Date(payload.recover_until).toLocaleString()}.`
        : 'You can recover your profile within 30 days.',
    });

    await refreshProfile();
    setDeleting(false);
  };

  const handleRecoverProfile = async () => {
    if (!profile || !isDeleted) return;

    setRecovering(true);
    const response = await fetch('/api/profile/recover', { method: 'POST' });
    const payload = await response.json();

    if (!response.ok) {
      toast({ title: 'Error', description: payload.error || 'Failed to recover profile', variant: 'destructive' });
      setRecovering(false);
      return;
    }

    toast({ title: 'Profile recovered', description: 'Your profile is active again.' });
    await refreshProfile();
    setRecovering(false);
  };

  if (!profile) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-6 space-y-4 text-center">
          <h1 className="text-xl font-display font-bold text-foreground">Profile unavailable</h1>
          <p className="text-sm text-muted-foreground">
            Your profile could not be loaded. If this account was deleted after the recovery window, data may be permanently removed.
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
              disabled={isDeleted}
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
              disabled={isDeleted}
            />
          </div>

          <Button onClick={handleSave} className="w-full bubble-gradient text-primary-foreground" disabled={saving || isDeleted}>
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </div>

        <div className="bg-card rounded-xl border border-border p-6 mt-4 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Account Status</h2>

          {isDeleted ? (
            <>
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
                <div>
                  <p className="text-sm text-foreground font-medium">Profile scheduled for deletion</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {recoverUntil
                      ? `Recover before ${recoverUntil.toLocaleString()} to keep your account.`
                      : 'Recover within 30 days to keep your account.'}
                  </p>
                </div>
              </div>

              <Button
                onClick={handleRecoverProfile}
                className="w-full"
                disabled={recovering}
              >
                {recovering && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                <RotateCcw className="w-4 h-4 mr-2" />
                Recover Profile
              </Button>
            </>
          ) : (
            <Button
              variant="destructive"
              onClick={handleDeleteProfile}
              className="w-full"
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Profile (30-day recovery)
            </Button>
          )}
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
