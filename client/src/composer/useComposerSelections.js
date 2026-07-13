/**
 * Composer 侧文件 @ 提及与技能多选状态，并持久化选中技能路径到 localStorage。
 *
 * Keywords: file mentions, skills, localStorage, composer state
 *
 * Exports:
 * - useComposerSelections — 返回 mentions/技能选择与增删 API。
 *
 * Inward: ../app/session-utils.js（safeStoredJsonArray）、上层 status.skills。
 *
 * Outward: App.jsx 与 Composer.jsx
 */

import { useEffect, useState } from 'react';
import { safeStoredJsonArray } from '../app/session-utils.js';

const SELECTED_SKILLS_KEY = 'codexmobile.selectedSkills';

export function useComposerSelections(status, controlled = {}) {
  const [internalFileMentions, setInternalFileMentions] = useState([]);
  const [internalSelectedSkillPaths, setInternalSelectedSkillPaths] = useState(() =>
    safeStoredJsonArray(SELECTED_SKILLS_KEY).filter((item) => typeof item === 'string' && item.trim())
  );
  const fileMentions = Array.isArray(controlled.fileMentions) ? controlled.fileMentions : internalFileMentions;
  const setFileMentions = controlled.setFileMentions || setInternalFileMentions;
  const selectedSkillPaths = Array.isArray(controlled.selectedSkillPaths)
    ? controlled.selectedSkillPaths
    : internalSelectedSkillPaths;
  const setSelectedSkillPaths = controlled.setSelectedSkillPaths || setInternalSelectedSkillPaths;

  useEffect(() => {
    localStorage.setItem(SELECTED_SKILLS_KEY, JSON.stringify(selectedSkillPaths));
  }, [selectedSkillPaths]);

  useEffect(() => {
    if (!Array.isArray(status.skills) || !status.skills.length || !selectedSkillPaths.length) {
      return;
    }
    const available = new Set(status.skills.map((skill) => skill.path));
    const next = selectedSkillPaths.filter((item) => available.has(item));
    if (next.length !== selectedSkillPaths.length) {
      setSelectedSkillPaths(next);
    }
  }, [selectedSkillPaths, status.skills]);

  function toggleSelectedSkill(path) {
    const value = String(path || '').trim();
    if (!value) {
      return;
    }
    setSelectedSkillPaths((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value]
    );
  }

  function selectSkill(path) {
    const value = String(path || '').trim();
    if (!value) {
      return;
    }
    setSelectedSkillPaths((current) => current.includes(value) ? current : [...current, value]);
  }

  function clearSelectedSkills() {
    setSelectedSkillPaths([]);
  }

  function addFileMention(file) {
    const pathValue = String(file?.path || '').trim();
    if (!pathValue) {
      return;
    }
    setFileMentions((current) => {
      if (current.some((item) => item.path === pathValue)) {
        return current;
      }
      return [
        ...current,
        {
          name: file.name || pathValue.split('/').pop() || pathValue,
          path: pathValue,
          relativePath: file.relativePath || file.name || pathValue
        }
      ].slice(0, 12);
    });
  }

  function removeFileMention(pathValue) {
    setFileMentions((current) => current.filter((item) => item.path !== pathValue));
  }

  return {
    fileMentions,
    setFileMentions,
    selectedSkillPaths,
    setSelectedSkillPaths,
    toggleSelectedSkill,
    selectSkill,
    clearSelectedSkills,
    addFileMention,
    removeFileMention
  };
}
