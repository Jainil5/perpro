export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface InboxItem {
  id: string;
  content: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  priority: Priority;
  status: 'open' | 'done';
  due_date: string | null;
  tags: string[];
  meeting_id: string | null;
  sort_order: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  attendees: string | null;
  location: string | null;
  agenda: string | null;
  notes: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface NewsItem {
  id: string;
  url: string;
  title: string;
  source: string;
  summary: string | null;
  published_at: string | null;
  fetched_at: string;
  saved: boolean;
}

export interface FootballTeam {
  id: string;
  name: string;
  league: string;
  badge: string | null;
  short?: string | null;
}

export interface FootballMatch {
  id: string;
  timestamp: string;
  league: string;
  round: string | null;
  home: { id: string; name: string; badge: string | null };
  away: { id: string; name: string; badge: string | null };
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  url: string;
}