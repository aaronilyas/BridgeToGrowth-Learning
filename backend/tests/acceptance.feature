Feature: Required FastAPI backend behavior
  The API coordinates authenticated lesson generation, isolated rendering,
  independent evaluation, temporary artifacts, and Node-mediated text delivery.
  Scenario IDs link to the coverage map and execution contract in README.md.

  Background:
    Given registered users A and B with distinct authenticated sessions and recipients
    And a disposable database, controllable clock, and observable dependency boundaries

  Scenario: AUTH-01 Registration establishes usable account identity
    Given the supported public registration flow is configured
    When a new user completes that flow
    Then the user has a stable account identity and intended text-message recipient
    And the resulting authenticated session can request a lesson as that user
    And subsequent requests resolve to the same account

  Scenario Outline: AUTH-02 Authentication gates protected operations
    When an actor with <credentials> attempts lesson submission or protected status retrieval
    Then access is denied without disclosing another user's records or artifacts
    And no generation, container startup, or delivery is triggered
    And no user's authenticated activity timestamp is refreshed
    Examples:
      | credentials                  |
      | no credentials               |
      | invalid credentials          |
      | expired or revoked credentials |

  Scenario Outline: LESSON-01 Scope gate respects the inclusive 90-second limit
    Given scope assessment returns a feasible lesson duration of <seconds> seconds
    When A submits the lesson
    Then the API produces <outcome>
    And rendering and delivery are <side_effects>
    Examples:
      | seconds | outcome                                      | side_effects                 |
      | 89      | an accepted lesson that can enter generation  | allowed after required gates |
      | 90      | an accepted lesson that can enter generation  | allowed after required gates |
      | 91      | actionable feedback to split into smaller topics | not started               |

  Scenario: LESSON-02 Actual output also respects the duration limit
    Given an accepted lesson whose estimate is within 90 seconds
    When its rendered video measures more than 90 seconds
    Then that video is not delivered as a compliant completed lesson
    And A can observe the resolution under the configured re-scope, retry, or failure policy

  Scenario: CONTAINER-01 Start on demand and reuse the owning container
    Given A's assigned container is stopped and B has a different assigned container
    When A submits an accepted lesson
    Then A's container is ready before any generated code executes
    And only A's container receives A's generation work
    When A submits another accepted lesson while that container is running
    Then work uses the same assigned container
    When concurrent requests need to start A's stopped container
    Then there is still only one assigned container for A
    And all admitted jobs remain attributable to A

  Scenario Outline: SECURITY-01 Enforce ownership across public resources
    Given B owns a job, status records, and temporary artifacts
    When A attempts <operation> using B's identifiers or file references
    Then no B data or artifact contents are disclosed or modified
    And no operation on B's container or delivery is triggered
    Examples:
      | operation                                      |
      | retrieve job status                            |
      | submit a lesson with a forged owner identity    |
      | access an artifact through any exposed API route |

  Scenario: SECURITY-02 Generated code cannot escape its user execution boundary
    Given generated-code fixtures attempt to read B's files and a host/API sentinel file
    And fixtures attempt path traversal or symlink access outside A's artifact boundary
    When the backend processes those fixtures for A
    Then generated code executes only inside A's isolated container
    And generation never executes in the API, Node service, or host process
    And B's files and the host/API sentinel cannot be read or changed
    And container mounts and privileges do not grant access to other users or the host runtime
    And escaped artifact references are not forwarded to evaluation or delivery

  Scenario: LIFECYCLE-01 Stop only after authenticated inactivity
    Given A's running container has no active jobs
    And A's last authenticated request occurred at time T
    When a cleanup sweep completes at T plus 24 minutes 59 seconds
    Then A's container remains running
    When a cleanup sweep completes at T plus 25 minutes 1 second
    Then A's container is stopped
    And a later accepted lesson can start A's assigned container again

  Scenario: LIFECYCLE-02 Only authenticated user activity refreshes inactivity
    Given A's last authenticated request occurred at time T
    When an unauthenticated request arrives at T plus 24 minutes
    Then A's last authenticated request timestamp remains T
    When A makes a valid authenticated user request at T plus 24 minutes
    Then the timestamp advances to that request's time
    And a cleanup sweep one minute later does not stop A's idle container

  Scenario Outline: LIFECYCLE-03 Never stop a container with active jobs
    Given A has had no authenticated requests for more than 25 minutes
    And A has <active_work> still active
    When a cleanup sweep completes
    Then A's container remains running and no stop or terminate operation is issued
    When all A's jobs finish and a subsequent cleanup sweep completes
    Then A's idle container is eligible to stop without requiring another user request
    Examples:
      | active_work                                      |
      | a generation job                                 |
      | a rendering job                                  |
      | an evaluation job                                |
      | a delivery job still using its temporary artifact |
      | two jobs, one completed and one still active      |

  Scenario: LIFECYCLE-04 Admission and shutdown cannot race past the active-job guard
    Given A's running container is idle and eligible for shutdown
    When job admission overlaps the cleanup sweep at controlled synchronization barriers
    Then if a job becomes active before shutdown commits the container is not stopped
    And if shutdown commits first the admitted job waits for its owning container to restart
    And no active job's container is stopped or terminated in either ordering

  Scenario: PIPELINE-01 Preserve original intent through the required pipeline
    When A submits a feasible lesson
    Then Gemini receives the original lesson intent in A's isolated generation environment
    And the resulting Manim code is rendered in A's container
    And the rendered result and original intent are passed to evaluation
    And only an acceptable evaluated video progresses to the Node delivery boundary
    And the API can correlate every stage with A and the original job

  Scenario Outline: PIPELINE-02 Optional voiceover is supported
    Given an accepted lesson with voiceover <setting>
    When the backend renders the lesson
    Then <audio_result>
    And the final video remains within 90 seconds including narration
    Examples:
      | setting  | audio_result                                              |
      | enabled  | Manim Voiceover creates explanations included in the video |
      | disabled | rendering succeeds without requiring voiceover generation |

  Scenario Outline: EVALUATION-01 Evaluate the actual video independently
    Given a rendered video with <evaluation_result>
    When evaluation completes
    Then a separate Gemini evaluation instance inspects the rendered video against original intent
    And it assesses accuracy, visual defects, and inconsistencies
    And <disposition>
    Examples:
      | evaluation_result              | disposition                                                        |
      | acceptable content             | the video may progress to delivery                                 |
      | inaccurate lesson content      | the rejected result does not progress as an approved completed lesson |
      | visible rendering defects      | the rejected result does not progress as an approved completed lesson |
      | inconsistent explanations      | the rejected result does not progress as an approved completed lesson |

  Scenario: DELIVERY-01 Photon stays behind the Node/TypeScript service boundary
    Given A's video has passed scope, rendering, and evaluation gates
    When FastAPI requests delivery
    Then it delegates the video and A's intended recipient to the Node/TypeScript service
    And Photon SDK calls occur only in that service
    And no Photon SDK integration is introduced into the Python service
    And the delegated artifact is accessible only for its intended temporary processing use
    And no message or artifact is sent to B

  Scenario Outline: DELIVERY-02 Reflect the actual delivery-service outcome
    Given A's approved video is submitted to the Node delivery service
    When the service reports <result>
    Then A can observe <observable_outcome> through the API's status mechanism
    And provider acceptance is never reported as confirmed user receipt without receipt evidence
    Examples:
      | result                    | observable_outcome                                    |
      | Photon accepted the message | acceptance associated with the correct lesson job  |
      | Photon rejected the message | delivery failure without a success claim           |
      | acceptance is unknown after timeout | an unresolved or failed outcome without a fabricated acceptance |

  Scenario: STATUS-01 Status supports the app throughout asynchronous work
    Given A has submitted an accepted lesson
    When work pauses at generation, rendering, evaluation, and delivery barriers
    Then A can obtain job-correlated progress for each observable stage
    And a completed rendering step alone does not claim evaluation or message acceptance
    When Photon acceptance is reported for that job
    Then A can observe acceptance through the API's status mechanism
    And B cannot obtain A's progress or recipient information

  Scenario Outline: STORAGE-01 Generated videos remain temporary
    Given A's workflow ends with <outcome>
    When processing and delivery no longer require its generated artifacts
    And the configured temporary-artifact cleanup completes
    Then complete and partial generated videos for that workflow have been removed
    And no generated video bytes or durable video copies exist in PostgreSQL, host storage, or object storage
    And container configuration does not persist generated videos across its lifecycle
    And metadata retained for job status does not retain a durable video location
    And B's active artifacts remain usable and untouched
    Examples:
      | outcome                       |
      | successful delivery handoff   |
      | scope rejection               |
      | generation failure            |
      | partial rendering failure     |
      | evaluation rejection          |
      | terminal delivery failure     |

  Scenario Outline: FAILURE-01 Dependency failures remain observable and contained
    Given A's workflow is about to call <dependency>
    When that dependency returns an error, malformed result, or configured timeout
    Then A can observe a job-correlated failure or configured recovery state
    And no later stage proceeds using missing or invalid prerequisite output
    And no completion or Photon acceptance is fabricated
    And B's jobs and artifacts are unaffected
    And terminal handling releases active-job protection only after work actually stops
    And temporary artifacts are eligible for cleanup when no longer needed
    Examples:
      | dependency              |
      | scope assessor          |
      | container startup       |
      | Gemini code generator   |
      | Manim renderer          |
      | Manim Voiceover         |
      | separate Gemini evaluator |
      | Node delivery service   |
      | PostgreSQL status update |
