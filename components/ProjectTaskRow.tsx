'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Tag } from './ui';
import { ProjectTask } from '@/lib/types';
import { dueTone } from '@/lib/os/format';
import { StatusDot } from '@/components/os/marks';
import { DueText, PriorityText, dotStateFor, dotToneForDue } from '@/components/os/TaskRow';

export default function ProjectTaskRow({
  task,
  onToggle,
  onEdit,
  onCopyPrompt,
}: {
  task: ProjectTask;
  onToggle: (task: ProjectTask) => void;
  onEdit: (task: ProjectTask) => void;
  onCopyPrompt: (task: ProjectTask) => Promise<boolean>;
}) {
  const [openNotes, setOpenNotes] = useState(false);
  const [copied, setCopied] = useState(false);
  const tone = dotToneForDue(task.completed ? 'none' : dueTone(task.due_date));

  return (
    <div className={`border-b border-line ${task.completed ? 'opacity-60' : ''}`}>
      <div className="flex min-h-[36px] items-start gap-3 py-2">
        <button
          onClick={() => onToggle(task)}
          aria-label={task.completed ? 'Mark open' : 'Mark done'}
          className="os-tap-none flex h-9 w-5 shrink-0 items-center justify-start"
        >
          <StatusDot
            state={dotStateFor(task.completed ? 'done' : 'open')}
            tone={tone}
            title={task.completed ? 'Completed' : 'Open'}
          />
        </button>

        <button onClick={() => onEdit(task)} className="min-w-0 flex-1 text-left">
          <span
            className={`block text-[14px] ${
              task.completed ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}
          >
            {task.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            {task.category ? <Tag>{task.category}</Tag> : null}
            <PriorityText value={task.priority} />
            {task.source === 'import' ? <span className="os-micro">imported</span> : null}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-3">
          <DueText value={task.due_date} muted={task.completed} />

          <button
            onClick={async () => {
              if (await onCopyPrompt(task)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              }
            }}
            title="Copy an implementation brief for this task"
            aria-label={`Copy implement prompt for ${task.title}`}
            className={`os-tap-none flex h-9 shrink-0 items-center gap-1.5 rounded-os border px-2 text-[11px] transition-colors duration-150 ${
              copied
                ? 'border-success text-success'
                : 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {copied ? (
                <path d="M5 13l4 4L19 7" />
              ) : (
                <>
                  <path d="M9 4h6a1 1 0 011 1v1H8V5a1 1 0 011-1zM8 6H6a2 2 0 00-2 2v11a2 2 0 002 2h9a2 2 0 002-2v-2" />
                  <path d="M13 10h7v7a2 2 0 01-2 2h-5" />
                </>
              )}
            </svg>
            {copied ? 'copied' : 'prompt'}
          </button>

          {task.notes ? (
            <button
              onClick={() => setOpenNotes((v) => !v)}
              aria-expanded={openNotes}
              aria-label={openNotes ? 'Hide notes' : 'Show notes'}
              className="os-tap-none flex h-9 w-9 shrink-0 items-center justify-center rounded-os border border-transparent text-muted-foreground transition-colors duration-150 hover:border-line hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          ) : null}
        </span>
      </div>

      {openNotes && task.notes ? (
        <div className="os-enter border-t border-line">
          <div className="markdown-body max-h-72 overflow-y-auto px-4 py-3 text-xs">
            <ReactMarkdown>{task.notes}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}
