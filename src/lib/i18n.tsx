/**
 * 渲染进程的多语言层。
 *
 * 采用「中文原文即键」的做法：组件继续写中文，`t()` 在英文模式下查表替换。
 * 好处是新增文案忘记登记时只会退回中文，而不是在界面上显示一个点分键名。
 * 词典与主进程共用 shared/messages.ts，主进程的对话框和错误信息因此能保持同一语言。
 */
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { translate } from '../../shared/messages';
import type { AppLanguage } from '../../shared/types';

export type Translate = (text: string, ...values: unknown[]) => string;

type I18nValue = { language: AppLanguage; t: Translate; locale: string };
const I18nContext = createContext<I18nValue>({ language: 'en', t: text => text, locale: 'en-US' });

export function I18nProvider({ language, children }: { language: AppLanguage; children: React.ReactNode }) {
  const value = useMemo<I18nValue>(() => ({
    language,
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
    t: (text, ...values) => translate(language, text, ...values),
  }), [language]);
  useEffect(() => { document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'; }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue { return useContext(I18nContext); }

/** 语言感知的日期格式化，供列表等高频渲染路径使用。 */
export function useLocaleDate() {
  const { locale } = useI18n();
  return useCallback((value: string, options: Intl.DateTimeFormatOptions) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale, options);
  }, [locale]);
}

