import { Link } from "wouter";
import { useListWorkspaces } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { formatNGN, formatUSDC } from "@/lib/currency";
import { ArrowRight, MapPin, Zap, Shield, Sparkles, MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: workspaces, isLoading } = useListWorkspaces();

  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero Section */}
      <section className="relative py-24 md:py-32 overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-background via-background/90 to-primary/10 z-10" />
          <img 
            src="/src/assets/the-hub.png" 
            alt="Hero background" 
            className="w-full h-full object-cover opacity-30"
          />
        </div>
        
        <div className="container relative z-10 px-4 md:px-6 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 mb-8">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">Lagos to the World</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold tracking-tighter max-w-4xl mb-6 text-balance">
            Coworking for the <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">Blockchain Nomad</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 text-balance">
            Premium workspace in Lagos. Pay by the second in USDC or NGN. 
            No deposits, no paperwork, just invisible Web3 magic.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/workspaces">
              <Button size="lg" className="h-12 px-8 text-base">
                Explore Workspaces
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            <Link href="/baire">
              <Button size="lg" variant="outline" className="h-12 px-8 text-base glass-panel">
                Chat with Baire AI
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Featured Spaces */}
      <section className="py-20 bg-card border-y border-border/50">
        <div className="container px-4 md:px-6">
          <div className="flex justify-between items-end mb-12">
            <div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Featured Spaces</h2>
              <p className="text-muted-foreground">High-performance environments for high-performance work.</p>
            </div>
            <Link href="/workspaces">
              <Button variant="ghost" className="hidden sm:flex group">
                View all spaces
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-80 w-full rounded-xl" />
              ))
            ) : workspaces?.slice(0, 4).map((ws) => (
              <Link key={ws.id} href={`/workspaces/${ws.id}`} className="group block">
                <div className="bg-background rounded-xl border border-border/50 overflow-hidden hover:border-primary/50 transition-colors h-full flex flex-col">
                  <div className="aspect-[4/3] relative overflow-hidden">
                    <img 
                      src={ws.image_url || '/src/assets/the-hub.png'} 
                      alt={ws.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3 bg-background/80 backdrop-blur-sm px-2 py-1 rounded-md text-xs font-medium uppercase border border-white/10">
                      {(ws.workspace_type ?? 'hot_desk').replace('_', ' ')}
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col">
                    <h3 className="font-bold text-lg mb-1">{ws.name}</h3>
                    <p className="text-muted-foreground text-sm line-clamp-2 mb-4 flex-1">
                      {ws.description}
                    </p>
                    <div className="flex items-end justify-between mt-auto">
                      <div className="flex flex-col">
                        <span className="text-sm text-muted-foreground">From</span>
                        <span className="font-bold text-lg text-primary">{formatUSDC(ws.hourly_rate_usdc)}/hr</span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">{formatNGN(ws.hourly_rate_ngn)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24">
        <div className="container px-4 md:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl font-bold tracking-tight mb-4">Built for the next internet</h2>
            <p className="text-muted-foreground text-lg">We stripped away everything that slows you down.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
                <Zap className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3">Pay by the Second</h3>
              <p className="text-muted-foreground">
                Stop paying for hours you don't use. Our smart contracts tick by the second. Check out anytime.
              </p>
            </div>
            
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center text-accent mb-6">
                <Shield className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3">Invisible Wallets</h3>
              <p className="text-muted-foreground">
                Fund with Paystack NGN, we handle the USDC conversion and Web3 wallet creation seamlessly behind the scenes.
              </p>
            </div>

            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6">
                <MapPin className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-3">Prime Locations</h3>
              <p className="text-muted-foreground">
                Curated spaces in the heart of Lagos. Ergonomic chairs, fiber internet, and artisan coffee standard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Baire Teaser */}
      <section className="py-20 bg-primary/5 border-t border-primary/10 relative overflow-hidden">
        <div className="container px-4 md:px-6 relative z-10">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
              <h2 className="text-4xl font-bold tracking-tight">Meet Baire.</h2>
              <p className="text-xl text-muted-foreground max-w-lg">
                Your AI concierge. Need a quiet spot for a call? Want to book a board room for tomorrow? Just ask Baire.
              </p>
              <Link href="/baire">
                <Button size="lg" className="mt-4">
                  Chat with Baire
                  <MessageSquare className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
            <div className="flex-1 w-full max-w-md">
              <div className="bg-card rounded-2xl border border-border p-6 shadow-xl shadow-primary/5">
                <div className="space-y-4">
                  <div className="bg-secondary rounded-2xl rounded-tr-sm p-4 w-fit max-w-[85%] ml-auto text-sm">
                    I need a desk for 3 hours, somewhere quiet.
                  </div>
                  <div className="bg-primary/10 text-foreground rounded-2xl rounded-tl-sm p-4 w-fit max-w-[85%] text-sm">
                    I recommend the Founders Suite. It's perfectly quiet with acoustic treatment. Shall I book it for you in USDC or NGN?
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
