import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Calendar,
  GitPullRequest,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";

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

  const prUrl = `https://github.com/${review.repo_name}/pull/${review.pr_number}`;

  return (
    <div className="w-full max-w-5xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => navigate(-1)}
        className="mb-4 pl-0 hover:pl-2 transition-all"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center hover:underline decoration-primary underline-offset-4"
            >
              {review.repo_name}
              <span className="text-muted-foreground text-2xl ml-2">
                #{review.pr_number}
              </span>
              <ExternalLink className="ml-2 h-5 w-5 opacity-0 group-hover:opacity-50 transition-opacity" />
            </a>
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
        <Badge
          variant={review.issues_found > 0 ? "destructive" : "default"}
          className="text-md px-4 py-1"
        >
          {review.issues_found} Issues Found
        </Badge>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AI Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose dark:prose-invert max-w-none bg-muted/30 p-6 rounded-md text-sm leading-relaxed">
            <ReactMarkdown
              components={{
                h1: ({ node, ...props }) => (
                  <h1 className="text-lg font-bold mt-4 mb-2" {...props} />
                ),
                h2: ({ node, ...props }) => (
                  <h2 className="text-md font-bold mt-3 mb-1" {...props} />
                ),
                ul: ({ node, ...props }) => (
                  <ul className="list-disc pl-5 mb-4 space-y-1" {...props} />
                ),
                li: ({ node, ...props }) => <li className="mb-1" {...props} />,
                code: ({ node, ...props }) => (
                  <code
                    className="bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded font-mono text-xs"
                    {...props}
                  />
                ),
                p: ({ node, ...props }) => (
                  <p className="mb-4 last:mb-0" {...props} />
                ),
              }}
            >
              {review.ai_comment}
            </ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
