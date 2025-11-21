import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, GitPullRequest } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ReviewDetails {
  _id: string;
  repo_name: string;
  pr_number: string;
  language: string;
  issues_found: number;
  ai_comment: string;
  analyzed_at: string;
}

export function ReviewDetialsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [review, setReview] = useState<ReviewDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchReview = async () => {
      try {
        const res = await fetch(`/api/reviews/${id}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setReview(data);
      } catch (error) {
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchReview();
  }, [id]);

  if (isLoading) return <div className="p-8">Loading details...</div>;
  if (!review) return <div className="p-8">Review not found.</div>;

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 pl-0 hover:pl-2 transition-all">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            {review.repo_name}
            <span className="text-muted-foreground text-2xl">#{review.pr_number}</span>
          </h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center">
              <GitPullRequest className="mr-1 h-4 w-4" />
              PR Review
            </span>
            <span className="flex items-center">
              <Calendar className="mr-1 h-4 w-4" />
              {new Date(review.analyzed_at).toLocaleString()}
            </span>
          </div>
        </div>
        <Badge variant={review.issues_found > 0 ? "destructive" : "default"} className="text-md px-4 py-1">
          {review.issues_found} Issues Found
        </Badge>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AI Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none whitespace-pre-wrap bg-muted/50 p-4 rounded-md">
            {review.ai_comment}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
