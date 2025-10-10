/*
 * Copyright 2022 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useMemo, useEffect, useRef } from 'react';
import {
  InfoCard,
  MarkdownContent,
  Progress,
  WarningPanel,
} from '@backstage/core-components';
import {
  discoveryApiRef,
  errorApiRef,
  useApi,
} from '@backstage/core-plugin-api';
import { stringifyError } from '@backstage/errors';
import { scmIntegrationsApiRef } from '@backstage/integration-react';
import { getAdrLocationUrl } from '@backstage-community/plugin-adr-common';
import { useEntity } from '@backstage/plugin-catalog-react';
import { CookieAuthRefreshProvider } from '@backstage/plugin-auth-react';
import { useTheme } from '@material-ui/core/styles';
import mermaid from 'mermaid';

import { adrDecoratorFactories } from './decorators';
import { AdrContentDecorator } from './types';
import { adrApiRef } from '../../api';
import useAsync from 'react-use/esm/useAsync';

/**
 * Component to fetch and render an ADR.
 *
 * @public
 */
export const AdrReader = (props: {
  adr: string;
  decorators?: AdrContentDecorator[];
}) => {
  const { adr, decorators } = props;
  const { entity } = useEntity();
  const scmIntegrations = useApi(scmIntegrationsApiRef);
  const adrApi = useApi(adrApiRef);
  const adrLocationUrl = getAdrLocationUrl(entity, scmIntegrations);
  const adrFileLocationUrl = getAdrLocationUrl(entity, scmIntegrations, adr);
  const discoveryApi = useApi(discoveryApiRef);
  const errorApi = useApi(errorApiRef);
  const contentRef = useRef<HTMLDivElement>(null);
  const theme = useTheme();

  const { value, loading, error } = useAsync(
    async () => adrApi.readAdr(adrFileLocationUrl),
    [adrFileLocationUrl],
  );

  const {
    value: backendUrl,
    loading: backendUrlLoading,
    error: backendUrlError,
  } = useAsync(async () => discoveryApi.getBaseUrl('adr'), []);
  const adrContent = useMemo(() => {
    if (!value?.data) {
      return '';
    }
    const adrDecorators = decorators ?? [
      adrDecoratorFactories.createRewriteRelativeLinksDecorator(),
      adrDecoratorFactories.createRewriteRelativeEmbedsDecorator(),
      adrDecoratorFactories.createFrontMatterFormatterDecorator(),
    ];

    return adrDecorators.reduce(
      (content, decorator) =>
        decorator({ baseUrl: adrLocationUrl, content, filename: adr }).content,
      value.data,
    );
  }, [adrLocationUrl, decorators, value, adr]);

  // Render mermaid diagrams after content updates
  useEffect(() => {
    const renderMermaidDiagrams = async () => {
      if (!contentRef.current || !adrContent) return;

      try {
        // Detect theme and configure Mermaid accordingly
        const isDarkTheme = theme.palette.type === 'dark';
        const mermaidTheme = isDarkTheme ? 'dark' : 'neutral';

        // Initialize mermaid with theme-aware settings
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: mermaidTheme,
        });

        // Find all mermaid code blocks within the content container
        const mermaidElements = contentRef.current.querySelectorAll(
          'code.language-mermaid',
        );

        if (mermaidElements.length > 0) {
          // Run mermaid to transform code blocks into diagrams
          await mermaid.run({
            nodes: Array.from(mermaidElements) as HTMLElement[],
          });
        }
      } catch (err) {
        // Log errors but don't break the entire ADR rendering
        errorApi.post(
          new Error(
            `Failed to render Mermaid diagrams: ${stringifyError(err)}`,
          ),
        );
      }
    };

    renderMermaidDiagrams();
  }, [adrContent, theme.palette.type, errorApi]);

  return (
    <CookieAuthRefreshProvider pluginId="adr">
      <InfoCard>
        {loading && <Progress />}

        {!loading && error && (
          <WarningPanel title="Failed to fetch ADR" message={error?.message} />
        )}

        {!backendUrlLoading && backendUrlError && (
          <WarningPanel
            title="Failed to fetch ADR images"
            message={backendUrlError?.message}
          />
        )}

        {!loading &&
          !backendUrlLoading &&
          !error &&
          !backendUrlError &&
          value?.data && (
            <div ref={contentRef}>
              <MarkdownContent
                content={adrContent}
                linkTarget="_blank"
                transformImageUri={href => {
                  return `${backendUrl}/image?url=${href}`;
                }}
              />
            </div>
          )}
      </InfoCard>
    </CookieAuthRefreshProvider>
  );
};

AdrReader.decorators = adrDecoratorFactories;
