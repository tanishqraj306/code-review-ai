import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Github,
  ExternalLink,
  Sparkles,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  RecentReviewsTable,
  type Review,
} from "@/components/RecentReviewsTable";
import ReactMarkdown from "react-markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogHeader,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";

interface RepositoryDetails {
  _id: string;
  full_name: string;
  url: string;
  status: string;
  reviews: Review[];
  ai_description?: string;
  last_analyzed_at?: string; // <-- Add this field
}

export function RepositoryDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<RepositoryDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const requestTimeRef = useRef<Date | null>(null);

  const fetchRepoDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/repositories/${id}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setRepo(data);

      if (isGenerating) {
        const analyzedAt = data.last_analyzed_at
          ? new Date(data.last_analyzed_at)
          : null;

        if (requestTimeRef.current && analyzedAt) {
          if (analyzedAt > requestTimeRef.current) {
            setIsGenerating(false);
            requestTimeRef.current = null; // Reset
          }
        } else if (!requestTimeRef.current && data.ai_description) {
          setIsGenerating(false);
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [id, isGenerating]);

  useEffect(() => {
    fetchRepoDetails();
  }, [fetchRepoDetails]);

  useEffect(() => {
    if (!isGenerating) return;
    const interval = setInterval(fetchRepoDetails, 3000);
    return () => clearInterval(interval);
  }, [isGenerating, fetchRepoDetails]);

  const handleDeleteRepo = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/repositories/${id}`, { method: "DELETE" });
      if (res.ok) {
        navigate("/repositories"); // Redirect back to list
      } else {
        const errorData = await res.json();
        alert(`Failed to delete: ${errorData.message}`);
        setIsDeleting(false);
      }
    } catch (error) {
      console.error(error);
      setIsDeleting(false);
      alert("An error occurred.");
    }
  };

  const handleGenerateDescription = async () => {
    setIsGenerating(true);
    requestTimeRef.current = new Date();

    try {
      const res = await fetch(`/api/repositories/${id}/analyze`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to start analysis");
    } catch (error) {
      console.error(error);
      setIsGenerating(false);
      requestTimeRef.current = null;
      alert("Failed to start analysis.");
    }
  };

  if (isLoading) return <div className="p-8">Loading repository...</div>;
  if (!repo) return <div className="p-8">Repository not found.</div>;

  return (
    <div className="w-full space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/repositories")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">{repo.full_name}</h1>
          <Badge variant={repo.status === "active" ? "default" : "secondary"}>
            {repo.status}
          </Badge>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isDeleting}>
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Repository
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this repository?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will stop monitoring{" "}
                <strong>{repo.full_name}</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteRepo}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card className="border-primary/20 shadow-sm font-sans">
        <CardHeader className="bg-muted/30 pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg text-primary">
                <Sparkles className="h-5 w-5" />
                AI Project Summary
              </CardTitle>
              <CardDescription>
                Automated analysis of project structure, tech stack, and key
                features.
              </CardDescription>
            </div>

            {repo.ai_description && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateDescription}
                disabled={isGenerating}
                className="gap-2"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isGenerating ? "animate-spin" : ""}`}
                />
                <span className="hidden sm:inline">
                  {isGenerating ? "Updating..." : "Regenerate"}
                </span>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {repo.ai_description ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none
              /* Base Text Style */
              leading-relaxed text-muted-foreground
              
              /* Header Styling (Tech Stack, Key Features) */
              prose-headings:border-0 
              prose-headings:mb-3 prose-headings:mt-8 /* More space above headers */
              prose-h3:text-lg prose-h3:font-bold prose-h3:text-foreground /* Bold and white/black */
              
              /* List Styling */
              prose-ul:my-2 prose-ul:list-disc prose-ul:pl-4
              prose-li:my-1.5
              
              /* Strong text (Feature names) */
              prose-strong:text-foreground prose-strong:font-semibold
            "
            >
              {" "}
              <ReactMarkdown>{repo.ai_description}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-col gap-4 items-center justify-center py-8 text-center bg-muted/20 rounded-lg border border-dashed">
              <p className="text-muted-foreground max-w-[400px]">
                Generate a comprehensive summary of this repository to
                understand its purpose at a glance.
              </p>
              <Button
                variant="default"
                size="sm"
                onClick={handleGenerateDescription}
                disabled={isGenerating}
                className="gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Description
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pull Request History</h2>
          <Button variant="outline" asChild>
            <a href={repo.url} target="_blank" rel="noreferrer">
              <Github className="mr-2 h-4 w-4" />
              View on GitHub
              <ExternalLink className="ml-2 h-3 w-3" />
            </a>
          </Button>
        </div>

        <RecentReviewsTable data={repo.reviews} isLoading={false} />
      </div>
    </div>
  );
}
