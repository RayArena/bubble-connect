import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Shield, Users, Phone, Video, Zap, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import heroBg from '@/assets/hero-bg.jpg';

const features = [
  { icon: MessageCircle, title: 'Real-time Chat', desc: 'Instant messaging with friends and groups. Never miss a beat.' },
  { icon: Phone, title: 'Voice Calls', desc: 'Crystal-clear voice calls with anyone, anywhere in the world.' },
  { icon: Video, title: 'Video Calls', desc: 'Face-to-face conversations that bring you closer together.' },
  { icon: Users, title: 'Group Chats', desc: 'Create groups, manage members, and stay connected with your crew.' },
  { icon: Shield, title: 'Secure & Private', desc: 'Your conversations stay yours. Privacy by design.' },
  { icon: Zap, title: 'Lightning Fast', desc: 'Built for speed. Messages delivered in milliseconds.' },
];

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{ backgroundImage: `url(${heroBg})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />

        {/* Nav */}
        <nav className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bubble-gradient flex items-center justify-center bubble-glow">
              <MessageCircle className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-xl text-foreground">Bubble</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate('/auth')} className="text-muted-foreground hover:text-foreground">
              Sign In
            </Button>
            <Button onClick={() => navigate('/auth')} className="bubble-gradient text-primary-foreground font-semibold">
              Get Started
            </Button>
          </div>
        </nav>

        {/* Hero content */}
        <div className="relative z-10 text-center px-6 max-w-3xl mx-auto animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Now in beta — join the conversation
          </div>
          <h1 className="text-5xl md:text-7xl font-display font-bold text-foreground leading-tight mb-6">
            Where conversations{' '}
            <span className="bg-clip-text text-transparent bubble-gradient">come alive</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
            Chat, call, and connect with friends — all in one beautifully designed space. Fast, private, and built for the way you communicate.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate('/auth')}
              className="bubble-gradient text-primary-foreground font-semibold text-base px-8 bubble-glow"
            >
              Start Chatting
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-1.5">
            <div className="w-1.5 h-2.5 rounded-full bg-muted-foreground/50" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
              Everything you need to stay connected
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Packed with features that make communication effortless and enjoyable.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="w-12 h-12 rounded-xl bubble-gradient flex items-center justify-center mb-4 group-hover:bubble-glow transition-shadow duration-300">
                  <f.icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <h3 className="text-lg font-display font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="p-12 rounded-3xl bg-card border border-border relative overflow-hidden">
            <div className="absolute inset-0 bubble-gradient opacity-5" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">
                Ready to start?
              </h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
                Create your unique username and join the community. It only takes a minute.
              </p>
              <Button
                size="lg"
                onClick={() => navigate('/auth')}
                className="bubble-gradient text-primary-foreground font-semibold text-base px-10 bubble-glow"
              >
                Create Your Account
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bubble-gradient flex items-center justify-center">
              <MessageCircle className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-display font-semibold text-foreground">Bubble</span>
          </div>
          <p className="text-sm text-muted-foreground">© 2026 Bubble. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
