import {
  RecentReviewsTable,
  type Review,
} from "@/components/RecentReviewsTable";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Github, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface RepositoryDetails {
  _id: string;
  full_name: string;
  url: string;
  status: string;
  reviews: Review[];
  ai_description?: string;
}

export function RepositoryDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<RepositoryDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRepoDetails = async () => {
      try {
        const res = await fetch(`/api/repositories/${id}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setRepo(data);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRepoDetails();
  }, [id]);

  if (isLoading) return <div className="p-8">Loading repository...</div>;
  if (!repo) return <div className="p-8">Repository not found.</div>;

  return (
    <div className="w-full space-y-6">
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

      <Card className="bg-gradient-to-br from-background to-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Project Summary
          </CardTitle>
          <CardDescription>
            Generated analysis of the project structure and purpose.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            {repo.ai_description ? (
              <p>{repo.ai_description}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p>No AI description generated yet.</p>
                <Button variant="outline" className="w-fit" size="sm">
                  Generate Description
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Pull Request History</h2>
          <Button variant="outline" asChild>
            <a href={repo.url} target="_blank" rel="noreferrer">
              <Github className="mr-2 h-4 w-4" />
              View on Github
              <ExternalLink className="ml-2 h-3 w-3" />
            </a>
          </Button>
        </div>

        <RecentReviewsTable data={repo.reviews} isLoading={false} />
      </div>
    </div>
  );
}
