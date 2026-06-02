// Copyright (C) 2021-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import Layout from 'antd/lib/layout';
import Tabs from 'antd/lib/tabs';
import { useSelector } from 'react-redux';

import { DimensionType } from 'cvat-core-wrapper';
import ControlsSideBarContainer from 'containers/annotation-page/standard3D-workspace/controls-side-bar/controls-side-bar';
import ObjectSideBarComponent from 'components/annotation-page/standard-workspace/objects-side-bar/objects-side-bar';
import ObjectsListContainer from 'containers/annotation-page/standard-workspace/objects-side-bar/objects-list';
import CanvasContextMenuContainer from 'containers/annotation-page/canvas/canvas-context-menu';
import CanvasLayout from 'components/annotation-page/canvas/grid-layout/canvas-layout';
import CanvasPointContextMenuComponent from 'components/annotation-page/canvas/views/canvas2d/canvas-point-context-menu';
import RemoveConfirmComponent from 'components/annotation-page/standard-workspace/remove-confirm';
import PropagateConfirmComponent from 'components/annotation-page/standard-workspace/propagate-confirm';
import { CombinedState } from 'reducers';
import { FusionWorkspace } from 'components/lidar-fusion';

export default function StandardWorkspace3DComponent(): JSX.Element {
    const [activeTab, setActiveTab] = useState<string>('3d');

    // Read task and job IDs from Redux state
    const { taskId, jobId, hasCameraCalibrations } = useSelector((state: CombinedState) => {
        const job = state.annotation.job.instance;
        return {
            taskId: (job as any)?.taskId ?? null,
            jobId: (job as any)?.id ?? null,
            // Show fusion tab if the task has any related files (context images)
            hasCameraCalibrations: (state.annotation.player.frame.relatedFiles as number) > 0,
        };
    });

    const showFusionTab = hasCameraCalibrations && taskId !== null && jobId !== null;

    return (
        <Layout hasSider className='cvat-standard-workspace'>
            <ControlsSideBarContainer />

            <Layout.Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {showFusionTab ? (
                    <Tabs
                        activeKey={activeTab}
                        onChange={setActiveTab}
                        size='small'
                        tabBarStyle={{
                            margin: 0,
                            paddingLeft: 8,
                            background: '#1a1a2e',
                            borderBottom: '1px solid #333',
                        }}
                        items={[
                            {
                                key: '3d',
                                label: '3D Annotation',
                                children: <CanvasLayout type={DimensionType.DIMENSION_3D} />,
                            },
                            {
                                key: 'fusion',
                                label: '📷 Sensor Fusion',
                                children: (
                                    <FusionWorkspace
                                        taskId={taskId}
                                        jobId={jobId}
                                    />
                                ),
                            },
                        ]}
                    />
                ) : (
                    <CanvasLayout type={DimensionType.DIMENSION_3D} />
                )}
            </Layout.Content>

            <ObjectSideBarComponent objectsList={<ObjectsListContainer />} />
            <PropagateConfirmComponent />
            <CanvasContextMenuContainer />
            <CanvasPointContextMenuComponent />
            <RemoveConfirmComponent />
        </Layout>
    );
}
