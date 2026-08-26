import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="w-full flex flex-col items-center justify-center bg-background text-foreground p-4 min-h-full">
      <div className="w-24 h-24 rounded-full bg-secondary/50 flex items-center justify-center mb-8 animate-bounce">
        <AlertTriangle className="w-12 h-12 text-brand" />
      </div>
      
      <h1 className="text-4xl md:text-6xl font-display font-bold mb-4 text-center">
        404 Not Found
      </h1>
      
      <p className="text-xl text-muted-foreground mb-8 text-center max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>

      <Button asChild size="lg" className="rounded-full bg-primary hover:bg-primary/90 shadow-lg shadow-primary/25">
        <Link href="/">
          Return to Feed
        </Link>
      </Button>
    </div>
  );
}
