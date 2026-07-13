/**
 * 运行中交互请求卡片：处理 Codex app-server 的计划提问、补充信息、命令审批与权限授权。
 *
 * Keywords: interaction, approval, user-input, mobile-card, api
 *
 * Exports:
 * - InteractionRequestMessage — 渲染 pending interaction 并提交 approve/decline/answers。
 *
 * Inward: apiFetch、lucide-react。
 *
 * Outward: ChatMessage.jsx
 */

import { Check, ChevronLeft, ChevronRight, Circle, Pencil, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '../api.js';

function interactionLabel(kind) {
  if (kind === 'command_approval') {
    return '命令审批';
  }
  if (kind === 'file_approval') {
    return '文件修改';
  }
  if (kind === 'permissions') {
    return '权限授权';
  }
  if (kind === 'elicitation') {
    return '补充信息';
  }
  return '检查方式';
}

function isApprovalKind(kind) {
  return ['command_approval', 'file_approval', 'permissions'].includes(kind);
}

function optionValue(option) {
  return option?.value || option?.id || option?.label || '';
}

function answerText(value) {
  return String(value || '').trim();
}

export function InteractionRequestMessage({ message }) {
  const interaction = message.interaction || {};
  const questions = Array.isArray(interaction.questions) ? interaction.questions : [];
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [customAnswers, setCustomAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [hidden, setHidden] = useState(false);
  const currentQuestion = questions[Math.min(questionIndex, Math.max(questions.length - 1, 0))] || null;
  const selectedAnswer = currentQuestion ? answers[currentQuestion.id] || '' : '';
  const customAnswer = currentQuestion ? customAnswers[currentQuestion.id] || '' : '';
  const isApproval = isApprovalKind(interaction.kind);
  const canGoBack = questionIndex > 0;
  const canGoForward = questionIndex < questions.length - 1;
  const answeredIds = useMemo(() => new Set(
    questions
      .filter((question) => answerText(answers[question.id]) || answerText(customAnswers[question.id]))
      .map((question) => question.id)
  ), [answers, customAnswers, questions]);
  const currentAnswered = !currentQuestion || answeredIds.has(currentQuestion.id);
  const unansweredCount = Math.max(0, questions.length - answeredIds.size);
  const canSubmit = isApproval || !questions.length || unansweredCount === 0;

  const promptLines = useMemo(() =>
    String(interaction.prompt || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  [interaction.prompt]);

  if (hidden || message.status === 'completed') {
    return null;
  }

  function setCurrentAnswer(value) {
    if (!currentQuestion?.id) {
      return;
    }
    setSubmitError('');
    setAnswers((current) => ({ ...current, [currentQuestion.id]: value }));
    setCustomAnswers((current) => ({ ...current, [currentQuestion.id]: '' }));
  }

  function setCurrentCustomAnswer(value) {
    if (!currentQuestion?.id) {
      return;
    }
    setSubmitError('');
    setCustomAnswers((current) => ({ ...current, [currentQuestion.id]: value }));
    if (value.trim()) {
      setAnswers((current) => ({ ...current, [currentQuestion.id]: '' }));
    }
  }

  function answerPayload() {
    const result = {};
    for (const question of questions) {
      const custom = answerText(customAnswers[question.id]);
      const selected = answerText(answers[question.id]);
      if (custom) {
        result[question.id] = custom;
      } else if (selected) {
        result[question.id] = selected;
      }
    }
    return result;
  }

  function goNext() {
    if (!currentAnswered) {
      return;
    }
    setQuestionIndex((value) => Math.min(questions.length - 1, value + 1));
  }

  async function submit(action) {
    if (!interaction.id || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const answers = answerPayload();
      await apiFetch(`/api/chat/interactions/${encodeURIComponent(interaction.id)}/respond`, {
        method: 'POST',
        body: {
          action,
          answers,
          content: answers
        }
      });
      setHidden(true);
    } catch (error) {
      setSubmitError(error?.message || '提交失败，请重新选择后再确认');
      setSubmitting(false);
    }
  }

  async function skip() {
    if (!interaction.id || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/chat/interactions/${encodeURIComponent(interaction.id)}/cancel`, {
        method: 'POST',
        body: { action: 'decline' }
      });
      setHidden(true);
    } catch (error) {
      setSubmitError(error?.message || '跳过失败，请稍后重试');
      setSubmitting(false);
    }
  }

  return (
    <div className="message-row is-interaction-request">
      <section className="interaction-request-panel" aria-label={interaction.title || '需要你确认'}>
        <header className="interaction-request-header">
          {questions.length > 1 ? (
            <button type="button" className="interaction-nav-button" disabled={!canGoBack} onClick={() => setQuestionIndex((value) => Math.max(0, value - 1))} aria-label="上一题">
              <ChevronLeft size={17} />
            </button>
          ) : <span className="interaction-request-icon"><ShieldCheck size={17} /></span>}
          <span>{questions.length > 1 ? `第 ${questionIndex + 1} 题，共 ${questions.length} 题` : interactionLabel(interaction.kind)}</span>
          {questions.length > 1 ? (
            <button type="button" className="interaction-nav-button" disabled={!canGoForward} onClick={() => setQuestionIndex((value) => Math.min(questions.length - 1, value + 1))} aria-label="下一题">
              <ChevronRight size={17} />
            </button>
          ) : null}
        </header>

        <div className="interaction-request-body">
          <small>{currentQuestion?.header || interactionLabel(interaction.kind)}</small>
          <strong>{currentQuestion?.question || interaction.title || '需要你确认'}</strong>
          {currentQuestion?.description ? <p>{currentQuestion.description}</p> : null}
          {promptLines.length ? (
            <div className="interaction-request-detail">
              {promptLines.map((line) => <code key={line}>{line}</code>)}
            </div>
          ) : null}
        </div>

        {isApproval ? (
          <div className="interaction-approval-actions">
            <button type="button" className="interaction-action-button is-primary" disabled={submitting} onClick={() => submit('approve')}>
              <Check size={16} />
              <span>{submitting ? '提交中' : '允许'}</span>
            </button>
            <button type="button" className="interaction-action-button" disabled={submitting} onClick={skip}>
              <X size={16} />
              <span>拒绝</span>
            </button>
          </div>
        ) : (
          <>
            <div className="interaction-options">
              {(currentQuestion?.options || []).map((option) => {
                const value = optionValue(option);
                const selected = selectedAnswer === value;
                return (
                  <button
                    type="button"
                    key={value || option.label}
                    className={`interaction-option ${selected ? 'is-selected' : ''}`}
                    onClick={() => setCurrentAnswer(value)}
                  >
                    {selected ? <Check size={16} /> : <Circle size={16} />}
                    <span>
                      <strong>
                        {option.label}
                        {option.recommended && !/\brecommended\b/i.test(option.label) ? <em>Recommended</em> : null}
                      </strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {currentQuestion?.allowCustom !== false ? (
              <label className="interaction-custom-answer">
                <Pencil size={15} aria-hidden="true" />
                <input
                  value={customAnswer}
                  onChange={(event) => setCurrentCustomAnswer(event.target.value)}
                  placeholder={currentQuestion?.placeholder || '请描述其他答案'}
                />
              </label>
            ) : null}
            {submitError ? <div className="interaction-submit-error" role="alert">{submitError}</div> : null}
            <footer className="interaction-request-footer">
              <button type="button" className="interaction-action-button" disabled={submitting} onClick={skip}>
                跳过
              </button>
              {canGoForward ? (
                <button type="button" className="interaction-action-button is-primary" disabled={submitting || !currentAnswered} onClick={goNext}>
                  下一题
                </button>
              ) : (
                <button type="button" className="interaction-action-button is-primary" disabled={submitting || !canSubmit} onClick={() => submit('approve')}>
                  {submitting ? '提交中' : unansweredCount ? `还差 ${unansweredCount} 题` : '确认'}
                </button>
              )}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
